import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { MAILBOX_COUNT_CAP, type MailboxListResponse, type PublicMailbox } from '../shared/api'
import { addDomain, api, createUser, json, login, setSetting } from './helpers'

let cookie: string
let domainId: string
let userId: string

beforeEach(async () => {
  domainId = await addDomain('mail.test')
  userId = await createUser('alice')
  cookie = await login('alice')
})

async function create(body: Record<string, unknown>, envOverrides?: Record<string, string>): Promise<Response> {
  return api('/api/mailboxes', { cookie, body: { domainId, ...body }, env: envOverrides })
}

async function list(query = ''): Promise<MailboxListResponse> {
  return json<MailboxListResponse>(await api(`/api/mailboxes${query}`, { cookie }))
}

async function setQuota(quota: number): Promise<void> {
  await env.DB.prepare('UPDATE users SET mailbox_quota = ? WHERE id = ?').bind(quota, userId).run()
}

describe('creating mailboxes', () => {
  it('generates a readable random address on the chosen domain', async () => {
    const res = await create({})
    expect(res.status).toBe(201)
    const { mailbox } = await json<{ mailbox: PublicMailbox }>(res)
    expect(mailbox.address).toMatch(/^[a-hj-km-np-z][a-hj-km-np-z2-9]{9}@mail\.test$/)
    expect(mailbox).toMatchObject({ status: 'active', domain: 'mail.test', messageCount: 0, unreadCount: 0 })
  })

  it('accepts a custom prefix, normalizing case and whitespace, with a note', async () => {
    const res = await create({ localPart: '  Shop.Receipts ', note: ' for shopping ' })
    expect(res.status).toBe(201)
    const { mailbox } = await json<{ mailbox: PublicMailbox }>(res)
    expect(mailbox.address).toBe('shop.receipts@mail.test')
    expect(mailbox.note).toBe('for shopping')
  })

  it('rejects invalid and reserved prefixes', async () => {
    for (const localPart of ['ab', 'a'.repeat(33), '.lead', 'trail-', 'dou..ble', 'plus+tag', 'spa ce', 'ünï', 'postmaster', 'ADMIN', 'info', 'Billing']) {
      const res = await create({ localPart })
      expect(res.status, localPart).toBe(400)
      expect(await json(res), localPart).toEqual({ error: 'invalid_local_part' })
    }
  })

  it('refuses unknown or disabled domains', async () => {
    const disabled = await addDomain('old.test', false)
    for (const id of [disabled, 'no-such-domain']) {
      const res = await api('/api/mailboxes', { cookie, body: { domainId: id } })
      expect(res.status).toBe(400)
      expect(await json(res)).toEqual({ error: 'domain_unavailable' })
    }
  })

  it('never reuses an address, including retired ones', async () => {
    expect((await create({ localPart: 'taken' })).status).toBe(201)
    expect(await json(await create({ localPart: 'TAKEN' }))).toEqual({ error: 'address_taken' })

    await env.DB.prepare('INSERT INTO retired_addresses (address, retired_at) VALUES (?, ?)')
      .bind('ghost@mail.test', Date.now())
      .run()
    const res = await create({ localPart: 'ghost' })
    expect(res.status).toBe(409)
    expect(await json(res)).toEqual({ error: 'address_taken' })
  })
})

describe('quota', () => {
  it('uses DEFAULT_MAILBOX_QUOTA unless an admin overrides it', async () => {
    expect((await list()).quota.limit).toBe(10)
    const res = await api('/api/mailboxes', { cookie, env: { DEFAULT_MAILBOX_QUOTA: '4' } })
    expect((await json<MailboxListResponse>(res)).quota.limit).toBe(4)
    await setSetting('default_mailbox_quota', '7')
    const overridden = await api('/api/mailboxes', { cookie, env: { DEFAULT_MAILBOX_QUOTA: '4' } })
    expect((await json<MailboxListResponse>(overridden)).quota.limit).toBe(7)
  })

  it('counts only active mailboxes, falling back to the default setting', async () => {
    await setSetting('default_mailbox_quota', '2')
    const a = (await json<{ mailbox: PublicMailbox }>(await create({}))).mailbox
    await create({})
    const over = await create({})
    expect(over.status).toBe(409)
    expect(await json(over)).toEqual({ error: 'mailbox_quota_exceeded' })
    expect((await list()).quota).toEqual({ used: 2, limit: 2 })

    // Disabling frees a slot ...
    await api(`/api/mailboxes/${a.id}`, { cookie, method: 'PATCH', body: { status: 'disabled' } })
    expect((await create({})).status).toBe(201)

    // ... and re-enabling is refused while the quota is full.
    const reenable = await api(`/api/mailboxes/${a.id}`, { cookie, method: 'PATCH', body: { status: 'active' } })
    expect(reenable.status).toBe(409)
    expect(await json(reenable)).toEqual({ error: 'mailbox_quota_exceeded' })
  })

  it('honours a per-user quota override, even under concurrent creation', async () => {
    await setQuota(3)
    const results = await Promise.all(Array.from({ length: 8 }, () => create({})))
    expect(results.filter((r) => r.status === 201)).toHaveLength(3)
    expect((await list()).quota).toEqual({ used: 3, limit: 3 })
  })
})

describe('listing, notes and status', () => {
  it('separates active and disabled mailboxes and supports search', async () => {
    const shop = (await json<{ mailbox: PublicMailbox }>(await create({ localPart: 'shop', note: 'Amazon orders' }))).mailbox
    await create({ localPart: 'news', note: 'Newsletters' })
    await api(`/api/mailboxes/${shop.id}`, { cookie, method: 'PATCH', body: { status: 'disabled' } })

    expect((await list()).items.map((m) => m.address)).toEqual(['news@mail.test'])
    expect((await list('?status=disabled')).items.map((m) => m.address)).toEqual(['shop@mail.test'])
    expect((await list('?status=disabled&q=amazon')).items).toHaveLength(1)
    expect((await list('?q=letter')).items).toHaveLength(1)
    expect((await list('?q=%25')).items).toHaveLength(0)
    expect((await list('?q=_')).items).toHaveLength(0)
  })

  it('filters by domain, combined with search', async () => {
    const otherId = await addDomain('other.test')
    await create({ localPart: 'shop', note: 'Orders' })
    await create({ localPart: 'shop', domainId: otherId, note: 'Orders too' })
    await create({ localPart: 'news', domainId: otherId })
    expect((await list(`?domain=${otherId}`)).items.map((m) => m.address)).toEqual(['news@other.test', 'shop@other.test'])
    expect((await list(`?domain=${domainId}&q=orders`)).items.map((m) => m.address)).toEqual(['shop@mail.test'])
    expect((await list('?domain=nope')).items).toEqual([])
  })

  it('caps per-mailbox message and unread counts (bounded D1 reads)', async () => {
    const box = (await json<{ mailbox: PublicMailbox }>(await create({ localPart: 'busy' }))).mailbox
    const insert = Array.from({ length: MAILBOX_COUNT_CAP + 20 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, is_read, received_at)
         VALUES (?, ?, ?, 'x@example.org', 'busy@mail.test', 1, ?, ?)`,
      ).bind(`m${i}`, box.id, userId, i < 10 ? 1 : 0, 1000 + i),
    )
    await env.DB.batch(insert)
    expect((await list()).items[0]).toMatchObject({ messageCount: MAILBOX_COUNT_CAP, unreadCount: MAILBOX_COUNT_CAP })
    const { results } = await env.DB.prepare('SELECT 1 FROM messages WHERE mailbox_id = ?').bind(box.id).all()
    expect(results).toHaveLength(MAILBOX_COUNT_CAP + 20)
  })

  it('toggles subaddressing per mailbox, off by default', async () => {
    const box = (await json<{ mailbox: PublicMailbox }>(await create({ localPart: 'tagged' }))).mailbox
    expect(box.acceptSubaddress).toBe(false)
    const patch = (body: unknown) => api(`/api/mailboxes/${box.id}`, { cookie, method: 'PATCH', body })
    expect((await json<{ mailbox: PublicMailbox }>(await patch({ acceptSubaddress: true }))).mailbox.acceptSubaddress).toBe(true)
    expect((await list()).items[0]?.acceptSubaddress).toBe(true)
    expect((await patch({ acceptSubaddress: 'yes' })).status).toBe(400)
    expect((await json<{ mailbox: PublicMailbox }>(await patch({ acceptSubaddress: false }))).mailbox.acceptSubaddress).toBe(false)
  })

  it('edits and clears notes, and toggles status back and forth', async () => {
    const { mailbox } = await json<{ mailbox: PublicMailbox }>(await create({}))
    const path = `/api/mailboxes/${mailbox.id}`
    expect((await json<{ mailbox: PublicMailbox }>(await api(path, { cookie, method: 'PATCH', body: { note: 'GitHub' } }))).mailbox.note).toBe('GitHub')
    expect((await json<{ mailbox: PublicMailbox }>(await api(path, { cookie, method: 'PATCH', body: { note: '' } }))).mailbox.note).toBeNull()
    expect((await json<{ mailbox: PublicMailbox }>(await api(path, { cookie, method: 'PATCH', body: { status: 'disabled' } }))).mailbox.status).toBe('disabled')
    expect((await json<{ mailbox: PublicMailbox }>(await api(path, { cookie, method: 'PATCH', body: { status: 'active' } }))).mailbox.status).toBe('active')
    expect((await api(path, { cookie, method: 'PATCH', body: {} })).status).toBe(400)
  })

  it('paginates with a cursor', async () => {
    await setQuota(60)
    const now = Date.now()
    const statements = Array.from({ length: 55 }, (_, i) =>
      env.DB.prepare(
        "INSERT INTO mailboxes (id, user_id, domain_id, address, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, ?)",
      ).bind(`mb-${i}`, userId, domainId, `bulk${i}@mail.test`, now - i, now - i),
    )
    await env.DB.batch(statements)
    const first = await list()
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).not.toBeNull()
    const second = await list(`?cursor=${encodeURIComponent(first.nextCursor!)}`)
    expect(second.items).toHaveLength(5)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((m) => m.id)).size).toBe(55)
    expect((await api('/api/mailboxes?cursor=garbage!!', { cookie })).status).toBe(400)
  })

  it('offers no way to delete a mailbox', async () => {
    const { mailbox } = await json<{ mailbox: PublicMailbox }>(await create({}))
    expect((await api(`/api/mailboxes/${mailbox.id}`, { cookie, method: 'DELETE' })).status).toBe(404)
    expect((await api(`/api/mailboxes/${mailbox.id}`, { cookie })).status).toBe(200)
  })

  it('lists only enabled domains to users', async () => {
    await addDomain('off.test', false)
    const { items } = await json<{ items: { domain: string }[] }>(await api('/api/domains', { cookie }))
    expect(items.map((d) => d.domain)).toEqual(['mail.test'])
  })
})

describe('abuse limits (security review)', () => {
  it('caps total mailboxes so create→disable loops cannot squat addresses', async () => {
    await setQuota(1)
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) {
      const res = await create({ localPart: `squat${i}` }, { MAX_TOTAL_MAILBOXES: '3' })
      statuses.push(res.status)
      if (res.status !== 201) {
        expect(await json(res)).toEqual({ error: 'mailbox_total_limit_reached' })
        continue
      }
      const { mailbox } = await json<{ mailbox: PublicMailbox }>(res)
      await api(`/api/mailboxes/${mailbox.id}`, { cookie, method: 'PATCH', body: { status: 'disabled' } })
    }
    expect(statuses).toEqual([201, 201, 201, 409, 409])
  })

  it('caps mailbox creations per 24 hours', async () => {
    const limits = { MAX_DAILY_MAILBOX_CREATIONS: '2' }
    expect((await create({}, limits)).status).toBe(201)
    expect((await create({}, limits)).status).toBe(201)
    const third = await create({}, limits)
    expect(third.status).toBe(429)
    expect(await json(third)).toEqual({ error: 'rate_limited' })
    // Older creations fall out of the window.
    await env.DB.prepare('UPDATE mailboxes SET created_at = created_at - 25 * 3600 * 1000').run()
    expect((await create({}, limits)).status).toBe(201)
  })

  it('refuses mixed-case addresses and domains at the database level', async () => {
    await expect(
      env.DB.prepare(
        "INSERT INTO mailboxes (id, user_id, domain_id, address, created_at, updated_at) VALUES ('x', ?, ?, 'Mixed@mail.test', 1, 1)",
      )
        .bind(userId, domainId)
        .run(),
    ).rejects.toThrow(/lowercase/)
    await expect(
      env.DB.prepare("INSERT INTO domains (id, domain, enabled, created_at) VALUES ('d', 'Upper.test', 1, 1)").run(),
    ).rejects.toThrow(/lowercase/)
  })

  it('strips control and bidi-override characters from notes', async () => {
    const res = await create({ note: 'pay‮pal\u0000 receipts⁦' })
    expect((await json<{ mailbox: PublicMailbox }>(res)).mailbox.note).toBe('paypal receipts')
  })

  it('treats re-enabling an already active mailbox as a no-op, not a quota error', async () => {
    await setQuota(1)
    const { mailbox } = await json<{ mailbox: PublicMailbox }>(await create({}))
    const res = await api(`/api/mailboxes/${mailbox.id}`, { cookie, method: 'PATCH', body: { status: 'active' } })
    expect(res.status).toBe(200)
  })
})
