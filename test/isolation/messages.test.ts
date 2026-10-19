/** User B — and even an admin — must not be able to observe or change user A's mail. */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { InboxSummary, MessageListResponse } from '../../shared/api'
import { addDomain, addMailboxRow, addMessageRow, api, createUser, json, login } from '../helpers'

let aliceBox: string
let aliceMessage: string
let callers: Record<string, string>

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  const aliceId = await createUser('alice')
  await createUser('bob')
  await createUser('root-admin', { role: 'admin' })
  aliceBox = await addMailboxRow(aliceId, domainId, 'alice@mail.test')
  aliceMessage = await addMessageRow(aliceBox, { subject: 'secret', code: '777777', html: '<p>private</p>' })
  callers = { bob: await login('bob'), admin: await login('root-admin') }
})

describe("other users (including admins) against user A's mail", () => {
  for (const who of ['bob', 'admin']) {
    it(`${who}: sees none of it in listings, searches or summaries`, async () => {
      const cookie = callers[who]!
      for (const query of ['', '?q=secret', '?code=1', '?unread=1', '?since=0']) {
        expect((await json<MessageListResponse>(await api(`/api/messages${query}`, { cookie }))).items, query).toEqual([])
      }
      expect(await json<InboxSummary>(await api('/api/messages/summary', { cookie }))).toEqual({ unread: 0, latestReceivedAt: null })
    })

    it(`${who}: gets 404 for A's message and mailbox filter, and changes nothing`, async () => {
      const cookie = callers[who]!
      const missing = await api('/api/messages/nope', { cookie })
      for (const req of [
        api(`/api/messages/${aliceMessage}`, { cookie }),
        api(`/api/messages/${aliceMessage}`, { cookie, method: 'PATCH', body: { isRead: true } }),
        api(`/api/messages/${aliceMessage}`, { cookie, method: 'DELETE' }),
        api(`/api/messages?mailbox=${aliceBox}`, { cookie }),
        api('/api/messages/mark-read', { cookie, body: { mailboxId: aliceBox } }),
      ]) {
        const res = await req
        expect(res.status).toBe(404)
        expect(await json(res)).toEqual(await json(missing.clone()))
      }
      const row = await env.DB.prepare('SELECT is_read FROM messages WHERE id = ?').bind(aliceMessage).first<{ is_read: number }>()
      expect(row?.is_read).toBe(0)
    })

    it(`${who}: "mark all read" never touches A's mail`, async () => {
      await api('/api/messages/mark-read', { cookie: callers[who]!, body: {} })
      const row = await env.DB.prepare('SELECT is_read FROM messages WHERE id = ?').bind(aliceMessage).first<{ is_read: number }>()
      expect(row?.is_read).toBe(0)
    })
  }

  it('anonymous callers get 401 everywhere', async () => {
    for (const path of ['/api/messages', '/api/messages/summary', `/api/messages/${aliceMessage}`]) {
      expect((await api(path)).status, path).toBe(401)
    }
  })
})
