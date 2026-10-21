/** User B — and an admin — can't send as user A, answer A's mail, or see A's sent mail. */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { OutboxListResponse, SentMessageDetail } from '../../shared/api'
import { addDomain, addMailboxRow, addMessageRow, api, createUser, json, login, setSetting } from '../helpers'

let aliceBox: string
let aliceMessage: string
let aliceSent: string
let callers: Record<string, { cookie: string; box: string }>

beforeEach(async () => {
  await setSetting('sending_enabled', 'true')
  const domainId = await addDomain('mail.test')
  await env.DB.prepare('UPDATE domains SET can_send = 1 WHERE id = ?').bind(domainId).run()
  const aliceId = await createUser('alice')
  const bobId = await createUser('bob')
  const adminId = await createUser('root-admin', { role: 'admin' })
  await env.DB.prepare('UPDATE users SET can_send = 1').run()
  aliceBox = await addMailboxRow(aliceId, domainId, 'alice@mail.test')
  aliceMessage = await addMessageRow(aliceBox, { subject: 'private question' })
  const sent = await api('/api/outbox', {
    cookie: await login('alice'),
    body: { mailboxId: aliceBox, to: ['x@example.org'], subject: 'secret', text: 'secret body', idempotencyKey: 'alice-key-1' },
  })
  aliceSent = (await json<{ message: SentMessageDetail }>(sent)).message.id
  callers = {
    bob: { cookie: await login('bob'), box: await addMailboxRow(bobId, domainId, 'bob@mail.test') },
    admin: { cookie: await login('root-admin'), box: await addMailboxRow(adminId, domainId, 'root@mail.test') },
  }
})

describe("other users (including admins) against user A's outbox", () => {
  for (const who of ['bob', 'admin']) {
    it(`${who}: can't send from A's address or answer A's mail`, async () => {
      const { cookie, box } = callers[who]!
      const base = { to: ['x@example.org'], subject: 'hi', text: 'hi' }
      const asAlice = await api('/api/outbox', { cookie, body: { ...base, mailboxId: aliceBox, idempotencyKey: `${who}-key-1` } })
      expect(asAlice.status).toBe(404)
      const reply = await api('/api/outbox', { cookie, body: { ...base, mailboxId: box, replyToId: aliceMessage, idempotencyKey: `${who}-key-2` } })
      expect(reply.status).toBe(404)
      // Reusing A's idempotency key must not return A's message.
      const reused = await api('/api/outbox', { cookie, body: { ...base, mailboxId: box, idempotencyKey: 'alice-key-1' } })
      expect((await json<{ message: SentMessageDetail }>(reused)).message.id).not.toBe(aliceSent)
    })

    it(`${who}: sees none of A's sent mail`, async () => {
      const { cookie } = callers[who]!
      expect((await api(`/api/outbox/${aliceSent}`, { cookie })).status).toBe(404)
      const { items } = await json<OutboxListResponse>(await api('/api/outbox', { cookie }))
      expect(items.map((m) => m.id)).not.toContain(aliceSent)
    })
  }

  it("A's message is untouched", async () => {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM sent_messages WHERE mailbox_id = ?').bind(aliceBox).first('n')
    expect(row).toBe(1)
  })
})
