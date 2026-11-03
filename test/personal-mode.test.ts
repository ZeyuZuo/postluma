import { createExecutionContext, env } from 'cloudflare:test'
import PostalMime from 'postal-mime'
import { beforeEach, describe, expect, it } from 'vitest'

import { isValidLocalPart, type MailboxListResponse, type PublicMailbox } from '../shared/api'
import { REJECT_UNAVAILABLE, handleEmail } from '../worker/email'
import { getConfig } from '../worker/lib/config'
import { prepareMessage } from '../worker/lib/mail-content'
import { findDeliveryTarget, storeMessage } from '../worker/repo/ingest'
import { DEFAULT_PASSWORD, addDomain, addMailboxRow, api, createUser, emailStub, json, login, mime, setSetting } from './helpers'

const personal = { SERVICE_MODE: 'personal' }

async function count(sql: string, ...params: unknown[]): Promise<number> {
  return (await env.DB.prepare(sql).bind(...params).first<{ n: number }>())?.n ?? 0
}

describe('personal mode: only administrators sign in', () => {
  it('closes registration whatever the setting says', async () => {
    await setSetting('registration_open', 'true')
    const res = await api('/api/auth/register', { body: { username: 'alice', password: DEFAULT_PASSWORD }, env: personal })
    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error: 'registration_closed' })
    expect(await json(await api('/api/settings/public', { env: personal }))).toEqual({ registrationOpen: false, mode: 'personal' })
  })

  it('refuses a non-admin with the right password, without a session', async () => {
    const alice = await createUser('alice')
    const res = await api('/api/auth/login', { body: { username: 'alice', password: DEFAULT_PASSWORD }, env: personal })
    expect(res.status).toBe(403)
    expect(await json(res)).toEqual({ error: 'admin_only' })
    expect(await count('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?', alice)).toBe(0)

    await createUser('root', { role: 'admin' })
    expect((await api('/api/auth/login', { body: { username: 'root', password: DEFAULT_PASSWORD }, env: personal })).status).toBe(200)
  })

  it('ends a non-admin session signed in before the switch', async () => {
    await createUser('alice')
    const cookie = await login('alice')
    const res = await api('/api/mailboxes', { cookie, env: personal })
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0')
    expect((await api('/api/mailboxes', { cookie })).status).toBe(200)
  })
})

describe('personal mode: mail only for administrators', () => {
  beforeEach(async () => {
    const domainId = await addDomain('mail.test')
    await addMailboxRow(await createUser('alice'), domainId, 'alice@mail.test')
    await addMailboxRow(await createUser('root', { role: 'admin' }), domainId, 'root@mail.test')
  })

  async function deliver(to: string, vars: Record<string, string> = personal) {
    const stub = emailStub(mime({ to }), { to })
    await handleEmail(stub, { ...env, ...vars } as Env, createExecutionContext())
    return stub
  }

  it("bounces mail for a non-admin's address", async () => {
    expect((await deliver('alice@mail.test')).rejected).toBe(REJECT_UNAVAILABLE)
    expect(await count("SELECT COUNT(*) AS n FROM messages WHERE to_address = 'alice@mail.test'")).toBe(0)
    expect((await deliver('root@mail.test')).rejected).toBeNull()
    expect(await count("SELECT COUNT(*) AS n FROM messages WHERE to_address = 'root@mail.test'")).toBe(1)
  })

  it('still delivers to non-admins in temporary mode', async () => {
    expect((await deliver('alice@mail.test', {})).rejected).toBeNull()
  })

  it('re-checks the owner role when the message is stored', async () => {
    const target = await findDeliveryTarget(env.DB, 'alice@mail.test', { adminOwnersOnly: false })
    expect(target).not.toBeNull()
    const prepared = prepareMessage(await PostalMime.parse(mime({ to: 'alice@mail.test' })), {
      from: 'sender@example.org',
      rawSize: 200,
      windowTruncated: false,
    })
    const limits = getConfig({ ...env, ...personal } as Env).ingest
    const result = await storeMessage(env.DB, target!, crypto.randomUUID(), prepared, null, Date.now(), limits)
    expect(result).toEqual({ stored: false, reason: 'unavailable' })
  })
})

describe('personal mode: addresses', () => {
  let cookie: string
  let domainId: string

  beforeEach(async () => {
    domainId = await addDomain('mail.test')
    await createUser('root', { role: 'admin' })
    cookie = await login('root')
  })

  function create(localPart: string | undefined, vars: Record<string, string> = {}) {
    return api('/api/mailboxes', { cookie, body: { domainId, localPart }, env: { ...personal, ...vars } })
  }

  it('has no active quota or total cap', async () => {
    const vars = { DEFAULT_MAILBOX_QUOTA: '1', MAX_TOTAL_MAILBOXES: '2' }
    for (const local of ['one', 'two', 'three']) expect((await create(local, vars)).status, local).toBe(201)
    const listed = await json<MailboxListResponse>(await api('/api/mailboxes', { cookie, env: { ...personal, ...vars } }))
    expect(listed.quota).toEqual({ used: 3, limit: null })
  })

  it('keeps the daily creation cap', async () => {
    const vars = { DEFAULT_MAILBOX_QUOTA: '1', MAX_TOTAL_MAILBOXES: '1', MAX_DAILY_MAILBOX_CREATIONS: '2' }
    expect((await create('one', vars)).status).toBe(201)
    expect((await create('two', vars)).status).toBe(201)
    const third = await create('three', vars)
    expect(third.status).toBe(429)
    expect(await json(third)).toEqual({ error: 'rate_limited' })
  })

  it('accepts reserved and short local parts, never "+"', async () => {
    for (const local of ['postmaster', 'me', 'a']) expect((await create(local)).status, local).toBe(201)
    for (const local of ['a+b', 'a'.repeat(33)]) {
      const res = await create(local)
      expect(res.status, local).toBe(400)
      expect(await json(res)).toEqual({ error: 'invalid_local_part' })
    }
  })

  it('re-enables an address without checking the quota', async () => {
    const vars = { DEFAULT_MAILBOX_QUOTA: '1' }
    await create('one', vars)
    const { mailbox } = await json<{ mailbox: PublicMailbox }>(await create('two', vars))
    const patch = (status: string) =>
      api(`/api/mailboxes/${mailbox.id}`, { cookie, method: 'PATCH', body: { status }, env: { ...personal, ...vars } })
    expect((await patch('disabled')).status).toBe(200)
    expect((await patch('active')).status).toBe(200)
  })
})

describe('isValidLocalPart', () => {
  it.each([
    ['me', true, false],
    ['a', true, false],
    ['postmaster', true, false],
    ['shop-jd', true, true],
    ['a+b', false, false],
    ['dou..ble', false, false],
    ['a'.repeat(33), false, false],
  ])('%s: personal %s, otherwise %s', (value, personalOk, strictOk) => {
    expect(isValidLocalPart(value, { personal: true })).toBe(personalOk)
    expect(isValidLocalPart(value)).toBe(strictOk)
  })
})
