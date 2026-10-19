import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminUserListResponse, MailboxListResponse } from '../shared/api'
import { DELETE_BATCH } from '../worker/repo/maintenance'
import { addDomain, addMailboxRow, addMessageRow, api, createUser, json, login } from './helpers'

let admin: string

beforeEach(async () => {
  admin = await login('admin', 'test-admin-password')
})

const act = (id: string, action: string) => api(`/api/admin/users/${id}/action`, { cookie: admin, body: { action } })
const status = async (id: string) =>
  (await env.DB.prepare('SELECT status FROM users WHERE id = ?').bind(id).first<{ status: string }>())?.status

describe('user list', () => {
  it('lists accounts with mailbox counts and the pending total, filterable by status and name', async () => {
    const domainId = await addDomain('mail.test')
    const alice = await createUser('alice')
    await createUser('pat', { status: 'pending' })
    await addMailboxRow(alice, domainId, 'a1@mail.test')
    await addMailboxRow(alice, domainId, 'a2@mail.test', 'disabled')

    const all = await json<AdminUserListResponse>(await api('/api/admin/users', { cookie: admin }))
    expect(all.pendingCount).toBe(1)
    expect(all.items.find((u) => u.username === 'alice')).toMatchObject({ status: 'active', activeMailboxes: 1, totalMailboxes: 2, mailboxQuota: null })
    expect(JSON.stringify(all)).not.toContain('a1@mail.test') // counts only, never addresses

    const pending = await json<AdminUserListResponse>(await api('/api/admin/users?status=pending', { cookie: admin }))
    expect(pending.items.map((u) => u.username)).toEqual(['pat'])
    const search = await json<AdminUserListResponse>(await api('/api/admin/users?q=ali', { cookie: admin }))
    expect(search.items.map((u) => u.username)).toEqual(['alice'])
  })
})

describe('status transitions', () => {
  it('approves, rejects, bans and unbans along the allowed paths only', async () => {
    const pat = await createUser('pat', { status: 'pending' })
    expect((await act(pat, 'ban')).status).toBe(409) // pending can't be banned
    expect((await act(pat, 'approve')).status).toBe(200)
    expect(await status(pat)).toBe('active')
    expect((await act(pat, 'approve')).status).toBe(409)
    expect((await act(pat, 'ban')).status).toBe(200)
    expect((await act(pat, 'unban')).status).toBe(200)
    expect(await status(pat)).toBe('active')

    const rob = await createUser('rob', { status: 'pending' })
    expect((await act(rob, 'reject')).status).toBe(200)
    expect((await act(rob, 'approve')).status).toBe(200) // a rejected request can still be approved later
  })

  it('signs a banned user out immediately', async () => {
    const id = await createUser('eve')
    const cookie = await login('eve')
    await act(id, 'ban')
    expect((await api('/api/auth/me', { cookie })).status).toBe(401)
    const sessions = await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(id).first<{ n: number }>()
    expect(sessions?.n).toBe(0)
  })

  it('refuses to change admin accounts (including the acting admin)', async () => {
    const adminId = (await env.DB.prepare("SELECT id FROM users WHERE username = 'admin'").first<{ id: string }>())!.id
    for (const action of ['ban', 'reject', 'approve', 'unban']) {
      const res = await act(adminId, action)
      expect(res.status, action).toBe(403)
      expect(await json(res)).toEqual({ error: 'cannot_modify_admin' })
    }
    expect((await api(`/api/admin/users/${adminId}`, { cookie: admin, method: 'DELETE' })).status).toBe(403)
    expect(await status(adminId)).toBe('active')
  })

  it('writes an audit entry per action', async () => {
    const id = await createUser('pat', { status: 'pending' })
    await act(id, 'approve')
    const row = await env.DB.prepare("SELECT target_id FROM audit_logs WHERE action = 'admin.user_approve'").first<{ target_id: string }>()
    expect(row?.target_id).toBe(id)
  })
})

describe('per-user quota', () => {
  it('overrides and resets a user quota', async () => {
    await createUser('alice')
    const id = (await env.DB.prepare("SELECT id FROM users WHERE username = 'alice'").first<{ id: string }>())!.id
    const cookie = await login('alice')
    const quota = async () => (await json<MailboxListResponse>(await api('/api/mailboxes', { cookie }))).quota.limit
    expect(await quota()).toBe(10)
    expect((await api(`/api/admin/users/${id}/quota`, { cookie: admin, method: 'PATCH', body: { mailboxQuota: 25 } })).status).toBe(204)
    expect(await quota()).toBe(25)
    await api(`/api/admin/users/${id}/quota`, { cookie: admin, method: 'PATCH', body: { mailboxQuota: null } })
    expect(await quota()).toBe(10)
    expect((await api(`/api/admin/users/${id}/quota`, { cookie: admin, method: 'PATCH', body: { mailboxQuota: -1 } })).status).toBe(400)
  })
})

describe('deleting a user', () => {
  it('purges mail in batches, then deletes the (banned) account and retires its addresses forever', async () => {
    const domainId = await addDomain('mail.test')
    const id = await createUser('leaver')
    const box = await addMailboxRow(id, domainId, 'leaver@mail.test')
    const statements = Array.from({ length: DELETE_BATCH + 120 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at) VALUES (?, ?, ?, 'x@y', 'leaver@mail.test', 1, ?)",
      ).bind(`lm${i}`, box, id, i),
    )
    for (let i = 0; i < statements.length; i += 200) await env.DB.batch(statements.slice(i, i + 200))

    expect(await json(await api(`/api/admin/users/${id}/message-count`, { cookie: admin }))).toEqual({ count: DELETE_BATCH + 120 })
    const stillActive = await api(`/api/admin/users/${id}`, { cookie: admin, method: 'DELETE' })
    expect(stillActive.status).toBe(409)
    expect(await json(stillActive)).toEqual({ error: 'invalid_state' }) // ban first: stops ingest and logins
    await act(id, 'ban')
    const tooMuchMail = await api(`/api/admin/users/${id}`, { cookie: admin, method: 'DELETE' })
    expect(await json(tooMuchMail)).toEqual({ error: 'user_has_messages' })

    expect(await json(await api(`/api/admin/users/${id}/purge-messages`, { cookie: admin, body: {} }))).toEqual({ deleted: DELETE_BATCH, done: false, budgetExhausted: false })
    // 120 left > DELETE_REMAINDER_MAX (100): still blocked; one more batch clears it.
    expect((await api(`/api/admin/users/${id}`, { cookie: admin, method: 'DELETE' })).status).toBe(409)
    expect(await json(await api(`/api/admin/users/${id}/purge-messages`, { cookie: admin, body: {} }))).toEqual({ deleted: 120, done: true, budgetExhausted: false })
    expect((await api(`/api/admin/users/${id}`, { cookie: admin, method: 'DELETE' })).status).toBe(204)

    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE id = ?').bind(id).first()).toEqual({ n: 0 })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM mailboxes WHERE user_id = ?').bind(id).first()).toEqual({ n: 0 })
    expect(await env.DB.prepare("SELECT address FROM retired_addresses").all().then((r) => r.results)).toEqual([{ address: 'leaver@mail.test' }])

    // Nobody can ever take the address again.
    await createUser('newbie')
    const res = await api('/api/mailboxes', { cookie: await login('newbie'), body: { domainId, localPart: 'leaver' } })
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: 'address_taken' })
  })
})

describe('daily deletion budget', () => {
  it('stops purging when MAX_DELETES_PER_DAY is spent, and refuses to purge admins', async () => {
    const domainId = await addDomain('mail.test')
    const id = await createUser('heavy')
    const box = await addMailboxRow(id, domainId, 'heavy@mail.test')
    const statements = Array.from({ length: 900 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at) VALUES (?, ?, ?, 'x@y', 'heavy@mail.test', 1, ?)",
      ).bind(`hm${i}`, box, id, i),
    )
    for (let i = 0; i < statements.length; i += 200) await env.DB.batch(statements.slice(i, i + 200))
    const vars = { MAX_DELETES_PER_DAY: '600' }
    const purge = async () => json(await api(`/api/admin/users/${id}/purge-messages`, { cookie: admin, body: {}, env: vars }))
    expect(await purge()).toEqual({ deleted: 500, done: false, budgetExhausted: false })
    expect(await purge()).toEqual({ deleted: 100, done: false, budgetExhausted: true })
    expect(await purge()).toEqual({ deleted: 0, done: false, budgetExhausted: true })
    const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first<{ n: number }>()
    expect(left?.n).toBe(300)

    const adminId = (await env.DB.prepare("SELECT id FROM users WHERE username = 'admin'").first<{ id: string }>())!.id
    expect((await api(`/api/admin/users/${adminId}/purge-messages`, { cookie: admin, body: {} })).status).toBe(403)
  })
})

describe('admin responses never include mail content', () => {
  it('user list, counts and purge results carry no subjects, senders or bodies', async () => {
    const domainId = await addDomain('mail.test')
    const id = await createUser('alice')
    const box = await addMailboxRow(id, domainId, 'alice@mail.test')
    await addMessageRow(box, { subject: 'TOP-SECRET-SUBJECT', from: 'secret-sender@example.org', html: '<p>SECRET BODY</p>' })
    const bodies = await Promise.all(
      ['/api/admin/users', `/api/admin/users/${id}/message-count`, '/api/admin/stats', '/api/admin/audit', '/api/admin/settings'].map(
        async (path) => (await api(path, { cookie: admin })).text(),
      ),
    )
    for (const body of bodies) expect(body).not.toMatch(/TOP-SECRET-SUBJECT|secret-sender|SECRET BODY|alice@mail\.test/)
  })
})
