/**
 * Cross-tenant matrix: user B (and anonymous callers) must not be able to observe or change
 * anything belonging to user A. Foreign resources look exactly like non-existent ones (404).
 */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MailboxListResponse, PublicMailbox } from '../../shared/api'
import { addDomain, api, createUser, json, login } from '../helpers'

let aliceCookie: string
let bobCookie: string
let aliceBox: PublicMailbox

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  await createUser('alice')
  await createUser('bob')
  aliceCookie = await login('alice')
  bobCookie = await login('bob')
  const res = await api('/api/mailboxes', {
    cookie: aliceCookie,
    body: { domainId, localPart: 'alice-secret', note: 'private note' },
  })
  aliceBox = (await json<{ mailbox: PublicMailbox }>(res)).mailbox
})

describe("user B against user A's mailboxes", () => {
  it('cannot see them in listings or searches', async () => {
    for (const query of ['', '?status=disabled', '?q=alice', '?q=private']) {
      const list = await json<MailboxListResponse>(await api(`/api/mailboxes${query}`, { cookie: bobCookie }))
      expect(list.items, query).toEqual([])
      expect(list.quota.used).toBe(0)
    }
  })

  it('gets 404 (same as non-existent) when reading by id', async () => {
    const foreign = await api(`/api/mailboxes/${aliceBox.id}`, { cookie: bobCookie })
    const missing = await api('/api/mailboxes/does-not-exist', { cookie: bobCookie })
    expect(foreign.status).toBe(404)
    expect(await json(foreign)).toEqual(await json(missing))
  })

  it('cannot change note or status, and nothing is modified', async () => {
    for (const body of [{ note: 'pwned' }, { status: 'disabled' }, { note: null, status: 'disabled' }]) {
      const res = await api(`/api/mailboxes/${aliceBox.id}`, { cookie: bobCookie, method: 'PATCH', body })
      expect(res.status).toBe(404)
    }
    const row = await env.DB.prepare('SELECT note, status, user_id FROM mailboxes WHERE id = ?').bind(aliceBox.id).first()
    expect(row).toMatchObject({ note: 'private note', status: 'active' })
  })

  it("cannot re-enable A's disabled mailbox", async () => {
    await api(`/api/mailboxes/${aliceBox.id}`, { cookie: aliceCookie, method: 'PATCH', body: { status: 'disabled' } })
    const res = await api(`/api/mailboxes/${aliceBox.id}`, { cookie: bobCookie, method: 'PATCH', body: { status: 'active' } })
    expect(res.status).toBe(404)
    const row = await env.DB.prepare('SELECT status FROM mailboxes WHERE id = ?').bind(aliceBox.id).first<{ status: string }>()
    expect(row?.status).toBe('disabled')
  })

  it("only ever sees their own rows, even with A's pagination cursor", async () => {
    const cursor = btoa(`${Date.now() + 60_000}:zzzz`)
    const list = await json<MailboxListResponse>(
      await api(`/api/mailboxes?cursor=${encodeURIComponent(cursor)}`, { cookie: bobCookie }),
    )
    expect(list.items).toEqual([])
  })

  it("cannot claim A's address", async () => {
    const domainId = (await env.DB.prepare("SELECT id FROM domains WHERE domain = 'mail.test'").first<{ id: string }>())!.id
    const res = await api('/api/mailboxes', { cookie: bobCookie, body: { domainId, localPart: 'alice-secret' } })
    expect(res.status).toBe(409)
    const owner = await env.DB.prepare("SELECT user_id FROM mailboxes WHERE address = 'alice-secret@mail.test'").all()
    expect(owner.results).toHaveLength(1)
  })

  it('ignores user_id or id smuggled into the body', async () => {
    const domainId = (await env.DB.prepare("SELECT id FROM domains WHERE domain = 'mail.test'").first<{ id: string }>())!.id
    const aliceId = (await env.DB.prepare("SELECT id FROM users WHERE username = 'alice'").first<{ id: string }>())!.id
    const res = await api('/api/mailboxes', {
      cookie: bobCookie,
      body: { domainId, localPart: 'bob-box', userId: aliceId, user_id: aliceId, id: aliceBox.id },
    })
    expect(res.status).toBe(201)
    const row = await env.DB.prepare("SELECT user_id, id FROM mailboxes WHERE address = 'bob-box@mail.test'").first<{ user_id: string; id: string }>()
    expect(row!.user_id).not.toBe(aliceId)
    expect(row!.id).not.toBe(aliceBox.id)
  })
})

describe('anonymous and non-admin callers', () => {
  it('cannot touch mailbox endpoints without a session', async () => {
    expect((await api('/api/mailboxes')).status).toBe(401)
    expect((await api(`/api/mailboxes/${aliceBox.id}`)).status).toBe(401)
    expect((await api('/api/mailboxes', { body: { domainId: 'x' } })).status).toBe(401)
    expect((await api('/api/domains')).status).toBe(401)
  })

  it('cannot use the admin domain endpoints', async () => {
    const domainId = (await env.DB.prepare("SELECT id FROM domains WHERE domain = 'mail.test'").first<{ id: string }>())!.id
    expect((await api('/api/admin/domains', { cookie: bobCookie })).status).toBe(403)
    expect((await api('/api/admin/domains', { cookie: bobCookie, body: { domain: 'evil.test' } })).status).toBe(403)
    expect((await api(`/api/admin/domains/${domainId}`, { cookie: bobCookie, method: 'PATCH', body: { enabled: false } })).status).toBe(403)
    expect((await api(`/api/admin/domains/${domainId}`, { cookie: bobCookie, method: 'DELETE' })).status).toBe(403)
    const row = await env.DB.prepare('SELECT enabled FROM domains WHERE id = ?').bind(domainId).first<{ enabled: number }>()
    expect(row?.enabled).toBe(1)
  })
})
