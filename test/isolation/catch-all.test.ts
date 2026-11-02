/** An address that catch-all created for administrator A is A's alone, like any other address. */
import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MailboxListResponse, MessageListResponse } from '../../shared/api'
import { handleEmail } from '../../worker/email'
import { addDomain, api, createUser, emailStub, json, login, mime } from '../helpers'

const personal = { SERVICE_MODE: 'personal' }
let autoId: string
let bob: string

beforeEach(async () => {
  const aliceId = await createUser('alice', { role: 'admin' })
  await createUser('bob', { role: 'admin' })
  const domainId = await addDomain('d.test')
  await env.DB.prepare('UPDATE domains SET catch_all_user_id = ? WHERE id = ?').bind(aliceId, domainId).run()
  const stub = emailStub(mime({ to: 'shop@d.test', subject: 'secret' }), { to: 'shop@d.test' })
  await handleEmail(stub, { ...env, ...personal } as Env, createExecutionContext())
  expect(stub.rejected).toBeNull()
  autoId = (await env.DB.prepare("SELECT id FROM mailboxes WHERE address = 'shop@d.test'").first<{ id: string }>())!.id
  bob = await login('bob')
})

describe("another administrator against A's auto-created address", () => {
  it('sees neither the address nor its mail', async () => {
    const { items } = await json<MailboxListResponse>(await api('/api/mailboxes', { cookie: bob, env: personal }))
    expect(items).toEqual([])
    const messages = await json<MessageListResponse>(await api('/api/messages', { cookie: bob, env: personal }))
    expect(messages.items).toEqual([])
  })

  it('gets 404 for it and changes nothing', async () => {
    expect((await api(`/api/mailboxes/${autoId}`, { cookie: bob, env: personal })).status).toBe(404)
    const patch = await api(`/api/mailboxes/${autoId}`, { cookie: bob, method: 'PATCH', body: { note: 'mine now', status: 'disabled' }, env: personal })
    expect(patch.status).toBe(404)
    expect(await env.DB.prepare('SELECT note, status FROM mailboxes WHERE id = ?').bind(autoId).first()).toEqual({ note: null, status: 'active' })
  })
})
