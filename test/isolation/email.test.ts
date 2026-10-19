/** Ownership of inbound mail comes only from the envelope recipient's mailbox row. */
import { createExecutionContext, env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import type { MailboxListResponse } from '../../shared/api'
import { handleEmail } from '../../worker/email'
import { addDomain, api, createUser, emailStub, json, login, mime } from '../helpers'

describe('inbound mail ownership', () => {
  it('ignores forged To / Delivered-To / X- headers and delivers only to the envelope owner', async () => {
    const domainId = await addDomain('mail.test')
    const aliceId = await createUser('alice')
    const bobId = await createUser('bob')
    for (const [userId, address] of [
      [aliceId, 'alice@mail.test'],
      [bobId, 'bob@mail.test'],
    ]) {
      await env.DB.prepare(
        "INSERT INTO mailboxes (id, user_id, domain_id, address, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', 1, 1)",
      )
        .bind(crypto.randomUUID(), userId, domainId, address)
        .run()
    }

    const raw = mime({
      to: 'bob@mail.test',
      subject: 'for bob?',
      headers: `Delivered-To: bob@mail.test\nX-Original-To: bob@mail.test\nX-User-Id: ${bobId}`,
    })
    await handleEmail(emailStub(raw, { to: 'alice@mail.test' }), env, createExecutionContext())

    const rows = (await env.DB.prepare('SELECT user_id, to_address FROM messages').all()).results
    expect(rows).toEqual([{ user_id: aliceId, to_address: 'alice@mail.test' }])

    const bobList = await json<MailboxListResponse>(await api('/api/mailboxes', { cookie: await login('bob') }))
    expect(bobList.items.every((m) => m.messageCount === 0)).toBe(true)
    const aliceList = await json<MailboxListResponse>(await api('/api/mailboxes', { cookie: await login('alice') }))
    expect(aliceList.items.map((m) => m.messageCount)).toEqual([1])
  })
})
