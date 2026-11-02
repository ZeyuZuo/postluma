/** Catch-all (personal mode): the first mail to an unknown address on a catch-all domain creates it. */
import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminDomain, AdminSettings, MailboxListResponse } from '../shared/api'
import { REJECT_FLOODED, REJECT_MALFORMED, REJECT_OVER_BUDGET, REJECT_UNAVAILABLE, handleEmail } from '../worker/email'
import { getConfig } from '../worker/lib/config'
import { findCatchAllTarget, findDeliveryTarget, ingestCheck, utcDay, type DeliveryTarget } from '../worker/repo/ingest'
import { addDomain, addMailboxRow, api, createUser, emailStub, json, login, mime, setSetting } from './helpers'

const personal = { SERVICE_MODE: 'personal' }
let rootId: string
let domainId: string

beforeEach(async () => {
  rootId = await createUser('root', { role: 'admin' })
  domainId = await addDomain('d.test')
  await env.DB.prepare('UPDATE domains SET catch_all_user_id = ? WHERE id = ?').bind(rootId, domainId).run()
})

async function deliver(to: string, vars: Record<string, string> = {}, raw = mime({ to })) {
  const stub = emailStub(raw, { to })
  await handleEmail(stub, { ...env, ...personal, ...vars } as Env, createExecutionContext())
  return stub.rejected
}

const mailbox = (address: string) =>
  env.DB.prepare('SELECT user_id, auto_created, status FROM mailboxes WHERE address = ?').bind(address).first()
const count = async (sql: string, ...params: unknown[]) =>
  (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())?.n ?? 0
const messagesTo = (address: string) => count('SELECT COUNT(*) AS n FROM messages WHERE to_address = ?', address)
const mailboxCount = () => count('SELECT COUNT(*) AS n FROM mailboxes')
const counters = () =>
  env.DB.prepare('SELECT auto_created, catch_all_messages FROM ingest_counters WHERE day = ?').bind(utcDay(Date.now())).first()

describe('catch-all delivery', () => {
  it('creates the address on the first mail and delivers it', async () => {
    expect(await deliver('shop-jd@d.test')).toBeNull()
    expect(await mailbox('shop-jd@d.test')).toEqual({ user_id: rootId, auto_created: 1, status: 'active' })
    expect(await messagesTo('shop-jd@d.test')).toBe(1)
    expect(await counters()).toEqual({ auto_created: 1, catch_all_messages: 1 })
  })

  it('delivers later mail to the same address', async () => {
    await deliver('shop-jd@d.test')
    expect(await deliver('shop-jd@d.test')).toBeNull()
    expect(await mailboxCount()).toBe(1)
    expect(await messagesTo('shop-jd@d.test')).toBe(2)
    expect(await counters()).toEqual({ auto_created: 1, catch_all_messages: 2 })
  })

  it('lowercases the envelope recipient', async () => {
    expect(await deliver('Shop-JD@D.test')).toBeNull()
    expect(await mailbox('shop-jd@d.test')).toMatchObject({ user_id: rootId })
  })

  it.each([
    ['a+b@d.test', 'a subaddress without its base address'],
    ['ab@d.test', 'too short'],
    ['postmaster@d.test', 'a reserved name'],
    ['bad..dots@d.test', 'an invalid local part'],
  ])('never creates %s (%s)', async (to) => {
    expect(await deliver(to)).toBe(REJECT_UNAVAILABLE)
    expect(await mailboxCount()).toBe(0)
    expect(await count('SELECT COUNT(*) AS n FROM messages')).toBe(0)
  })

  it('never re-creates retired or disabled addresses', async () => {
    await env.DB.prepare("INSERT INTO retired_addresses (address, retired_at) VALUES ('gone@d.test', 1)").run()
    await addMailboxRow(rootId, domainId, 'old@d.test', 'disabled')
    expect(await deliver('gone@d.test')).toBe(REJECT_UNAVAILABLE)
    expect(await deliver('old@d.test')).toBe(REJECT_UNAVAILABLE)
    expect(await mailboxCount()).toBe(1)
    expect(await mailbox('old@d.test')).toMatchObject({ status: 'disabled', auto_created: 0 })
  })

  it('does nothing in temporary mode, with catch-all off, on a disabled domain, or for an owner who is not an active admin', async () => {
    expect(await deliver('tt1@d.test', { SERVICE_MODE: 'temporary' })).toBe(REJECT_UNAVAILABLE)
    const cases: [string, string][] = [
      ['UPDATE domains SET catch_all_user_id = NULL', 'UPDATE domains SET catch_all_user_id = ?1'],
      ['UPDATE domains SET enabled = 0', 'UPDATE domains SET enabled = 1'],
      ["UPDATE users SET role = 'user'", "UPDATE users SET role = 'admin'"],
      ["UPDATE users SET status = 'banned'", "UPDATE users SET status = 'active'"],
    ]
    for (const [breakIt, restore] of cases) {
      await env.DB.prepare(breakIt).run()
      expect(await deliver('tt2@d.test'), breakIt).toBe(REJECT_UNAVAILABLE)
      await env.DB.prepare(restore).bind(...(restore.includes('?1') ? [rootId] : [])).run()
    }
    expect(await mailboxCount()).toBe(0)
    // With everything restored the same address is created: each refusal above was the condition's.
    expect(await deliver('tt2@d.test')).toBeNull()
  })

  it('stops creating at the daily cap; the admin override lifts it', async () => {
    const cap = { CATCH_ALL_MAX_PER_DAY: '2' }
    expect(await deliver('aa1@d.test', cap)).toBeNull()
    expect(await deliver('aa2@d.test', cap)).toBeNull()
    expect(await deliver('aa3@d.test', cap)).toBe(REJECT_UNAVAILABLE)
    expect(await mailbox('aa3@d.test')).toBeNull()
    expect(await deliver('aa1@d.test', cap)).toBeNull()
    await setSetting('catch_all_max_per_day', '3')
    expect(await deliver('aa3@d.test', cap)).toBeNull()
  })

  it('caps each auto-created address per hour; manual admin addresses are not capped', async () => {
    const cap = { CATCH_ALL_MAX_PER_ADDRESS_PER_HOUR: '2' }
    expect(await deliver('xx1@d.test', cap)).toBeNull()
    expect(await deliver('xx1@d.test', cap)).toBeNull()
    expect(await deliver('xx1@d.test', cap)).toBe(REJECT_FLOODED)
    await setSetting('catch_all_max_per_address_per_hour', '3')
    expect(await deliver('xx1@d.test', cap)).toBeNull()

    await addMailboxRow(rootId, domainId, 'mine@d.test')
    for (let i = 0; i < 4; i++) expect(await deliver('mine@d.test', cap)).toBeNull()
  })

  it('catch-all spam burst leaves room for manual addresses', async () => {
    await addMailboxRow(rootId, domainId, 'mine@d.test')
    const budget = { INGEST_MAX_MESSAGES_PER_DAY: '4' }
    expect(await deliver('ss1@d.test', budget)).toBeNull()
    expect(await deliver('ss2@d.test', budget)).toBeNull()
    // Auto-created addresses have used their half of today's budget.
    expect(await deliver('ss3@d.test', budget)).toBe(REJECT_UNAVAILABLE)
    expect(await mailbox('ss3@d.test')).toBeNull()
    expect(await deliver('ss1@d.test', budget)).toBe(REJECT_OVER_BUDGET)
    expect(await deliver('mine@d.test', budget)).toBeNull()
    expect(await deliver('mine@d.test', budget)).toBeNull()
  })

  it('keeps originals for auto-created addresses only within half of the daily R2 budget', async () => {
    await addMailboxRow(rootId, domainId, 'mine@d.test')
    const raw = { RAW_MAIL_MAX_MB_PER_DAY: '1' }
    // More than half of today's 1 MB of originals is used already.
    await env.DB.prepare('INSERT INTO ingest_counters (day, messages, bytes, raw_bytes) VALUES (?, 0, 0, 600000)').bind(utcDay(Date.now())).run()
    expect(await deliver('shop-jd@d.test', raw)).toBeNull()
    expect(await deliver('mine@d.test', raw)).toBeNull()
    const original = (to: string) => env.DB.prepare('SELECT raw_r2_key FROM messages WHERE to_address = ?').bind(to).first('raw_r2_key')
    expect(await original('shop-jd@d.test')).toBeNull()
    expect(await original('mine@d.test')).not.toBeNull()
  })

  it('creates no address when the message is refused', async () => {
    await env.DB.prepare('INSERT INTO ingest_counters (day, messages, bytes) VALUES (?, 5000, 0)').bind(utcDay(Date.now())).run()
    expect(await deliver('late@d.test')).toBe(REJECT_UNAVAILABLE)
    expect(await mailboxCount()).toBe(0)
    expect(await counters()).toEqual({ auto_created: 0, catch_all_messages: 0 })

    await env.DB.prepare('DELETE FROM ingest_counters').run()
    const lines = ['From: a@example.org', 'To: broken@d.test', 'Subject: nested', 'Message-ID: <n@x>', 'MIME-Version: 1.0']
    for (let i = 0; i < 30; i++) lines.push(`Content-Type: multipart/mixed; boundary="b${i}"`, '', `--b${i}`)
    lines.push('Content-Type: text/plain', '', 'deep')
    expect(await deliver('broken@d.test', {}, lines.join('\n'))).toBe(REJECT_MALFORMED)
    expect(await mailboxCount()).toBe(0)
  })

  it('two first deliveries to one new address create it once', async () => {
    const results = await Promise.all([deliver('race@d.test'), deliver('race@d.test')])
    expect(await mailboxCount()).toBe(1)
    for (const rejected of results) expect([null, REJECT_UNAVAILABLE]).toContain(rejected)
    expect(await messagesTo('race@d.test')).toBe(results.filter((r) => r === null).length)
  })

  it('takes ownership from the domain, never from headers', async () => {
    const bossId = await createUser('boss', { role: 'admin' })
    await addMailboxRow(bossId, domainId, 'boss@d.test')
    const raw = mime({ to: 'boss@d.test', headers: 'Delivered-To: boss@d.test\nX-Original-To: boss@d.test' })
    expect(await deliver('new@d.test', {}, raw)).toBeNull()
    expect(await mailbox('new@d.test')).toMatchObject({ user_id: rootId })
    expect(await count('SELECT COUNT(*) AS n FROM messages WHERE user_id = ?', bossId)).toBe(0)
  })

  it('does not use up the daily cap for addresses created by hand', async () => {
    const vars = { MAX_DAILY_MAILBOX_CREATIONS: '1' }
    expect(await deliver('cc1@d.test')).toBeNull()
    expect(await deliver('cc2@d.test')).toBeNull()
    const cookie = await login('root')
    const res = await api('/api/mailboxes', { cookie, body: { domainId, localPart: 'byhand' }, env: { ...personal, ...vars } })
    expect(res.status).toBe(201)
  })
})

describe('catch-all addresses in the address list', () => {
  it('are marked as auto-created', async () => {
    await addMailboxRow(rootId, domainId, 'mine@d.test')
    await deliver('shop-jd@d.test')
    const { items } = await json<MailboxListResponse>(await api('/api/mailboxes', { cookie: await login('root'), env: personal }))
    expect(Object.fromEntries(items.map((m) => [m.address, m.autoCreated]))).toEqual({ 'mine@d.test': false, 'shop-jd@d.test': true })
  })

  it('can be left out with ?manual=1', async () => {
    await addMailboxRow(rootId, domainId, 'mine@d.test')
    await deliver('shop-jd@d.test')
    const res = await api('/api/mailboxes?manual=1', { cookie: await login('root'), env: personal })
    expect((await json<MailboxListResponse>(res)).items.map((m) => m.address)).toEqual(['mine@d.test'])
  })
})

describe('admin controls', () => {
  let cookie: string
  beforeEach(async () => {
    cookie = await login('root')
  })

  it('switch catch-all per domain, with an audit row', async () => {
    const patch = (catchAll: boolean, vars = personal) =>
      api(`/api/admin/domains/${domainId}`, { cookie, method: 'PATCH', body: { catchAll }, env: vars })
    const listed = async () => (await json<{ items: AdminDomain[] }>(await api('/api/admin/domains', { cookie, env: personal }))).items[0]!
    expect((await patch(false)).status).toBe(204)
    expect(await listed()).toMatchObject({ catchAll: false })
    expect((await patch(true)).status).toBe(204)
    expect(await listed()).toMatchObject({ catchAll: true })
    expect(await env.DB.prepare('SELECT catch_all_user_id FROM domains WHERE id = ?').bind(domainId).first('catch_all_user_id')).toBe(rootId)
    expect(await count("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'admin.domain_catch_all'")).toBe(2)
    expect((await patch(true, { SERVICE_MODE: 'temporary' })).status).toBe(404)
  })

  it('override the catch-all limits and reset them', async () => {
    const patch = (body: Record<string, unknown>, vars = personal) => api('/api/admin/settings', { cookie, method: 'PATCH', body, env: vars })
    const settings = async () => json<AdminSettings>(await api('/api/admin/settings', { cookie, env: personal }))
    expect((await patch({ catchAllMaxPerDay: 5, catchAllMaxPerAddressPerHour: 7 })).status).toBe(200)
    expect(await settings()).toMatchObject({
      catchAllMaxPerDay: 5,
      catchAllMaxPerAddressPerHour: 7,
      overridden: { catchAllMaxPerDay: true, catchAllMaxPerAddressPerHour: true },
      defaults: { catchAllMaxPerDay: 10, catchAllMaxPerAddressPerHour: 10 },
    })
    expect((await patch({ catchAllMaxPerDay: null })).status).toBe(200)
    expect(await settings()).toMatchObject({ catchAllMaxPerDay: 10, overridden: { catchAllMaxPerDay: false } })
    expect((await patch({ catchAllMaxPerDay: 5 }, { SERVICE_MODE: 'temporary' })).status).toBe(404)
  })
})

describe('the pre-check before parsing', () => {
  it('reads a bounded number of rows however much mail the administrator got this hour', async () => {
    const mine = await addMailboxRow(rootId, domainId, 'mine@d.test')
    const now = Date.now()
    const inserts = Array.from({ length: 2000 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at)
         VALUES (?, ?, ?, 'a@example.org', 'mine@d.test', 1, ?)`,
      ).bind(`m${i}`, mine, rootId, now - 1_000 - i),
    )
    for (let i = 0; i < inserts.length; i += 200) await env.DB.batch(inserts.slice(i, i + 200))
    const limits = getConfig({ ...env, ...personal } as Env).ingest
    const rowsRead = async (target: DeliveryTarget) => {
      const { sql, params } = ingestCheck(target, now, 0, limits)
      return (await env.DB.prepare(sql).bind(...params).all()).meta.rows_read
    }
    // A spam message to a new address and a message to the administrator's own address.
    expect(await rowsRead((await findCatchAllTarget(env.DB, 'new@d.test', 'new-id'))!)).toBeLessThan(20)
    expect(await rowsRead((await findDeliveryTarget(env.DB, 'mine@d.test', limits))!)).toBeLessThan(20)
  })
})
