import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OutboxListResponse, OutboxStatus, SentMessageDetail } from '../shared/api'
import { runCleanup } from '../worker/jobs/cleanup'
import { RESEND_API } from '../worker/lib/mailer/resend'
import { addDomain, addMailboxRow, addMessageRow, api, createUser, json, login, setSetting } from './helpers'

let aliceId: string
let domainId: string
let box: string
let cookie: string
let keyCounter = 0
const key = () => `key-${++keyCounter}-abcdef`

const mail = (extra: Record<string, unknown> = {}) => ({
  mailboxId: box,
  to: ['friend@example.org'],
  subject: 'Hello',
  text: 'Hi there.',
  idempotencyKey: key(),
  ...extra,
})
const send = (body: unknown, opts: { cookie?: string; env?: Record<string, string> } = {}) =>
  api('/api/outbox', { cookie: opts.cookie ?? cookie, body, env: opts.env })

/** All three switches on: service, domain, user. */
async function allowSending(userId = aliceId): Promise<void> {
  await setSetting('sending_enabled', 'true')
  await env.DB.prepare('UPDATE domains SET can_send = 1 WHERE id = ?').bind(domainId).run()
  await env.DB.prepare('UPDATE users SET can_send = 1 WHERE id = ?').bind(userId).run()
}

beforeEach(async () => {
  domainId = await addDomain('mail.test')
  aliceId = await createUser('alice')
  box = await addMailboxRow(aliceId, domainId, 'alice@mail.test')
  cookie = await login('alice')
})
afterEach(() => vi.restoreAllMocks())

describe('sending switched off (the default)', () => {
  it('hides every endpoint except status, and /me says no', async () => {
    expect((await send(mail())).status).toBe(404)
    expect((await api('/api/outbox', { cookie })).status).toBe(404)
    expect(await json<OutboxStatus>(await api('/api/outbox/status', { cookie }))).toMatchObject({ canSend: false, mailboxIds: [] })
    expect(await json<{ canSend: boolean }>(await api('/api/auth/me', { cookie }))).toMatchObject({ canSend: false })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sent_messages').first('n')).toBe(0)
  })

  it('needs the user and the domain switched on too', async () => {
    await setSetting('sending_enabled', 'true')
    expect(await json(await send(mail()))).toEqual({ error: 'sending_not_allowed' })
    await env.DB.prepare('UPDATE users SET can_send = 1 WHERE id = ?').bind(aliceId).run()
    expect(await json(await send(mail()))).toEqual({ error: 'sending_domain_not_allowed' })
    expect(await json<OutboxStatus>(await api('/api/outbox/status', { cookie }))).toMatchObject({ canSend: false })
  })
})

describe('sending switched on', () => {
  beforeEach(() => allowSending())

  it('sends from the own address, lists it, audits metadata only', async () => {
    const res = await send(mail({ to: ['Friend@Example.org', 'friend@example.org', 'other@example.net'] }))
    expect(res.status).toBe(201)
    const { message } = await json<{ message: SentMessageDetail }>(res)
    expect(message).toMatchObject({ fromAddress: 'alice@mail.test', to: ['friend@example.org', 'other@example.net'], status: 'sent', error: null, text: 'Hi there.' })

    const list = await json<OutboxListResponse>(await api('/api/outbox', { cookie }))
    expect(list.items.map((m) => m.id)).toEqual([message.id])
    expect(list.items[0]).not.toHaveProperty('text')
    expect(await json<{ canSend: boolean }>(await api('/api/auth/me', { cookie }))).toMatchObject({ canSend: true })
    expect(await json<OutboxStatus>(await api('/api/outbox/status', { cookie }))).toEqual({
      canSend: true, remaining: 19, limit: 20, maxRecipients: 5, mailboxIds: [box],
    })

    const audit = await env.DB.prepare("SELECT actor_id, detail FROM audit_logs WHERE action = 'mail.send'").all<{ actor_id: string; detail: string }>()
    expect(audit.results).toEqual([{ actor_id: aliceId, detail: JSON.stringify({ recipients: 2, reply: false }) }])
  })

  it('sends once per idempotency key', async () => {
    const body = mail()
    const first = await json<{ message: SentMessageDetail }>(await send(body))
    const again = await send(body)
    expect(again.status).toBe(200)
    expect((await json<{ message: SentMessageDetail }>(again)).message.id).toBe(first.message.id)
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sent_messages').first('n')).toBe(1)
  })

  it('enforces the per-user quota; rejected sends are refunded, timeouts are not', async () => {
    await env.DB.prepare('UPDATE users SET send_quota = 2 WHERE id = ?').bind(aliceId).run()
    const resendEnv = { MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"message":"invalid"}', { status: 422 }))
    const rejected = await json<{ message: SentMessageDetail }>(await send(mail(), { env: resendEnv }))
    expect(rejected.message).toMatchObject({ status: 'failed', error: 'provider_rejected' })

    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
    const lost = await json<{ message: SentMessageDetail }>(await send(mail(), { env: resendEnv }))
    expect(lost.message).toMatchObject({ status: 'failed', error: 'provider_unavailable' })

    expect((await send(mail())).status).toBe(201) // the refunded one left room for this
    const full = await send(mail())
    expect(full.status).toBe(429)
    expect(await json(full)).toEqual({ error: 'send_quota_exceeded' })
  })

  it('enforces the service-wide daily limit across users', async () => {
    const bobId = await createUser('bob')
    const bobBox = await addMailboxRow(bobId, domainId, 'bob@mail.test')
    await allowSending(bobId)
    const limit = { SEND_MAX_PER_DAY: '1' }
    expect((await send(mail(), { env: limit })).status).toBe(201)
    const res = await send(mail({ mailboxId: bobBox }), { cookie: await login('bob'), env: limit })
    expect(await json(res)).toEqual({ error: 'send_daily_limit_reached' })
  })

  it('validates recipients, subject and body', async () => {
    expect(await json(await send(mail({ to: ['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org', 'e@x.org', 'f@x.org'] })))).toEqual({ error: 'too_many_recipients' })
    for (const bad of [
      { to: ['Friend <friend@example.org>'] },
      { to: ['friend@localhost'] },
      { to: [] },
      { subject: 'Hi\r\nBcc: victim@example.org' },
      { text: '   ' },
      { idempotencyKey: 'short' },
    ]) {
      expect((await send(mail(bad))).status, JSON.stringify(bad)).toBe(400)
    }
  })

  it('threads replies with the answered message id, from untrusted headers only when well-formed', async () => {
    const original = await addMessageRow(box, { subject: 'Question' })
    await env.DB.prepare('UPDATE messages SET message_id_header = ? WHERE id = ?').bind('<q-1@example.org>', original).run()
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"id":"re_1"}'))
    const resendEnv = { MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }
    await send(mail({ replyToId: original, subject: 'Re: Question' }), { env: resendEnv })
    const sent = spy.mock.calls.find(([url]) => String(url) === `${RESEND_API}/emails`)!
    expect(JSON.parse(String(sent[1]!.body)).headers).toEqual({ 'In-Reply-To': '<q-1@example.org>', References: '<q-1@example.org>' })

    await env.DB.prepare('UPDATE messages SET message_id_header = ? WHERE id = ?').bind('<x>\r\nBcc: v@example.org', original).run()
    spy.mockClear()
    await send(mail({ replyToId: original }), { env: resendEnv })
    const second = spy.mock.calls.find(([url]) => String(url) === `${RESEND_API}/emails`)!
    expect(JSON.parse(String(second[1]!.body)).headers).toBeUndefined()
  })

  it('refuses disabled addresses', async () => {
    await env.DB.prepare("UPDATE mailboxes SET status = 'disabled' WHERE id = ?").bind(box).run()
    expect(await json(await send(mail()))).toEqual({ error: 'sending_domain_not_allowed' })
  })

  it('follows mail retention', async () => {
    const { message } = await json<{ message: SentMessageDetail }>(await send(mail()))
    await env.DB.prepare('UPDATE sent_messages SET created_at = 0 WHERE id = ?').bind(message.id).run()
    expect((await runCleanup(env)).sentDeleted).toBe(1)
  })
})
