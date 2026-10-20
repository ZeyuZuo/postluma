import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminSettings, AdminStats, AuditListResponse } from '../shared/api'
import { runCleanup } from '../worker/jobs/cleanup'
import { DELETE_BATCH as MANUAL_CLEANUP_BATCH } from '../worker/repo/maintenance'
import { utcDay } from '../worker/repo/ingest'
import { DEFAULT_PASSWORD, addDomain, addMailboxRow, api, createUser, json, login } from './helpers'

let admin: string

beforeEach(async () => {
  admin = await login('admin', 'test-admin-password')
})

describe('settings', () => {
  it('shows deploy defaults, applies overrides and resets them', async () => {
    const initial = await json<AdminSettings>(await api('/api/admin/settings', { cookie: admin }))
    expect(initial).toMatchObject({
      registrationOpen: true,
      defaultMailboxQuota: 10,
      retentionDays: 30,
      overridden: { registrationOpen: false, defaultMailboxQuota: false, retentionDays: false },
      defaults: { registrationOpen: true, defaultMailboxQuota: 10, retentionDays: 30 },
    })
    const updated = await json<AdminSettings>(
      await api('/api/admin/settings', { cookie: admin, method: 'PATCH', body: { registrationOpen: false, defaultMailboxQuota: 3, retentionDays: 7 } }),
    )
    expect(updated).toMatchObject({ registrationOpen: false, defaultMailboxQuota: 3, retentionDays: 7, overridden: { registrationOpen: true, defaultMailboxQuota: true, retentionDays: true } })

    // The overrides take effect where they matter.
    const register = await api('/api/auth/register', { body: { username: 'late', password: DEFAULT_PASSWORD } })
    expect(register.status).toBe(403)
    expect((await runCleanup(env)).retentionDays).toBe(7)

    const reset = await json<AdminSettings>(await api('/api/admin/settings', { cookie: admin, method: 'PATCH', body: { registrationOpen: null, retentionDays: null } }))
    expect(reset).toMatchObject({ registrationOpen: true, retentionDays: 30, defaultMailboxQuota: 3 })
  })

  it('validates ranges', async () => {
    for (const body of [{ defaultMailboxQuota: -1 }, { retentionDays: 99999 }, { defaultMailboxQuota: 1.5 }, { retentionDays: 0 }, {}]) {
      expect((await api('/api/admin/settings', { cookie: admin, method: 'PATCH', body })).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('refuses a retention the database cannot hold at the configured daily intake', async () => {
    // 12 MB/day (wrangler.jsonc) × days must stay under 400 MB → at most 33 days.
    const settings = await json<AdminSettings>(await api('/api/admin/settings', { cookie: admin }))
    expect(settings.maxRetentionDays).toBe(33)
    const tooLong = await api('/api/admin/settings', { cookie: admin, method: 'PATCH', body: { retentionDays: 34 } })
    expect(tooLong.status).toBe(400)
    expect(await json(tooLong)).toEqual({ error: 'retention_too_long' })
    expect((await api('/api/admin/settings', { cookie: admin, method: 'PATCH', body: { retentionDays: 33 } })).status).toBe(200)
    // A smaller daily intake allows a longer retention, as long as R2 can hold the originals too.
    const patch = (retentionDays: number, vars: Record<string, string>) =>
      api('/api/admin/settings', { cookie: admin, method: 'PATCH', body: { retentionDays }, env: vars })
    expect((await patch(365, { INGEST_MAX_MB_PER_DAY: '1', RAW_MAIL_MAX_MB_PER_DAY: '0' })).status).toBe(200)
    // 250 MB/day of originals × days must stay under 9 GB → at most 36 days.
    expect((await patch(37, { INGEST_MAX_MB_PER_DAY: '1' })).status).toBe(400)
    expect((await patch(36, { INGEST_MAX_MB_PER_DAY: '1' })).status).toBe(200)
    // Without the R2 binding only the database limits retention.
    expect((await patch(365, { INGEST_MAX_MB_PER_DAY: '1', MAIL_BUCKET: undefined as unknown as string })).status).toBe(200)
  })
})

describe('stats', () => {
  it('reports accounts, mailboxes, 7-day intake, budget and database size', async () => {
    const domainId = await addDomain('mail.test')
    const id = await createUser('alice')
    await createUser('pat', { status: 'pending' })
    await addMailboxRow(id, domainId, 'a@mail.test')
    await addMailboxRow(id, domainId, 'b@mail.test', 'disabled')
    await env.DB.prepare('INSERT INTO ingest_counters (day, messages, bytes) VALUES (?, 12, 3400)').bind(utcDay(Date.now())).run()
    const stats = await json<AdminStats>(await api('/api/admin/stats', { cookie: admin }))
    expect(stats.users).toMatchObject({ active: 2, pending: 1 })
    expect(stats.mailboxes).toEqual({ active: 1, disabled: 1 })
    expect(stats.intake).toHaveLength(7)
    expect(stats.today).toMatchObject({ messages: 12, bytes: 3400, maxMessages: 5000, maxBytes: 12 * 1024 * 1024 })
    expect(stats.database.limitBytes).toBe(500 * 1024 * 1024)
    expect(typeof stats.database.bytes).toBe('number')
  })
})

describe('audit log', () => {
  it('lists newest first with actor names and paginates', async () => {
    const pat = await createUser('pat', { status: 'pending' })
    await api(`/api/admin/users/${pat}/action`, { cookie: admin, body: { action: 'approve' } })
    const page = await json<AuditListResponse>(await api('/api/admin/audit', { cookie: admin }))
    expect(page.items[0]).toMatchObject({ action: 'admin.user_approve', actorUsername: 'admin', targetId: pat, targetUsername: 'pat' })
    expect((await api('/api/admin/audit?cursor=bad!', { cookie: admin })).status).toBe(400)
  })
})

describe('manual cleanup', () => {
  it('deletes only mail older than the cutoff, in batches', async () => {
    const domainId = await addDomain('mail.test')
    const id = await createUser('alice')
    const box = await addMailboxRow(id, domainId, 'a@mail.test')
    const now = Date.now()
    const day = 24 * 3600 * 1000
    const statements = []
    for (let i = 0; i < MANUAL_CLEANUP_BATCH + 5; i++) {
      statements.push(
        env.DB.prepare(
          "INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at) VALUES (?, ?, ?, 'x@y', 'a@mail.test', 1, ?)",
        ).bind(`old${i}`, box, id, now - 40 * day - i),
      )
    }
    statements.push(
      env.DB.prepare(
        "INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at) VALUES ('fresh', ?, ?, 'x@y', 'a@mail.test', 1, ?)",
      ).bind(box, id, now - day),
    )
    for (let i = 0; i < statements.length; i += 200) await env.DB.batch(statements.slice(i, i + 200))

    expect(await json(await api('/api/admin/cleanup', { cookie: admin, body: { olderThanDays: 30 } }))).toEqual({ deleted: MANUAL_CLEANUP_BATCH, done: false, budgetExhausted: false })
    expect(await json(await api('/api/admin/cleanup', { cookie: admin, body: { olderThanDays: 30 } }))).toEqual({ deleted: 5, done: true, budgetExhausted: false })
    expect(await env.DB.prepare('SELECT id FROM messages').all().then((r) => r.results)).toEqual([{ id: 'fresh' }])
    expect((await api('/api/admin/cleanup', { cookie: admin, body: { olderThanDays: 0 } })).status).toBe(400)
  })

  it('the daily job respects the shared deletion budget', async () => {
    const domainId = await addDomain('mail.test')
    const id = await createUser('alice')
    const box = await addMailboxRow(id, domainId, 'a@mail.test')
    const old = Date.now() - 60 * 24 * 3600 * 1000
    const statements = Array.from({ length: 700 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at) VALUES (?, ?, ?, 'x@y', 'a@mail.test', 1, ?)",
      ).bind(`c${i}`, box, id, old - i),
    )
    for (let i = 0; i < statements.length; i += 200) await env.DB.batch(statements.slice(i, i + 200))
    const result = await runCleanup({ ...env, MAX_DELETES_PER_DAY: '600' } as Env)
    expect(result.messagesDeleted).toBe(600)
    // Spent for today: a manual cleanup now deletes nothing and says so.
    const manual = await api('/api/admin/cleanup', { cookie: admin, body: { olderThanDays: 1 }, env: { MAX_DELETES_PER_DAY: '600' } })
    expect(await json(manual)).toEqual({ deleted: 0, done: false, budgetExhausted: true })
  })

  it('the daily job also drops audit entries older than 90 days', async () => {
    await env.DB.prepare("INSERT INTO audit_logs (id, action, created_at) VALUES ('ancient', 'x', ?), ('recent', 'x', ?)")
      .bind(Date.now() - 100 * 24 * 3600 * 1000, Date.now())
      .run()
    await runCleanup(env)
    const ids = (await env.DB.prepare("SELECT id FROM audit_logs WHERE id IN ('ancient', 'recent')").all<{ id: string }>()).results.map((r) => r.id)
    expect(ids).toEqual(['recent'])
  })
})
