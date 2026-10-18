import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { AdminDomain } from '../shared/api'
import { api, createUser, json, login } from './helpers'

let admin: string

beforeEach(async () => {
  admin = await login('admin', 'test-admin-password')
})

async function domains(): Promise<AdminDomain[]> {
  return (await json<{ items: AdminDomain[] }>(await api('/api/admin/domains', { cookie: admin }))).items
}

describe('admin domain management', () => {
  it('adds, normalizes, lists, disables and re-enables domains', async () => {
    const res = await api('/api/admin/domains', { cookie: admin, body: { domain: '  Mail.Example.COM ' } })
    expect(res.status).toBe(201)
    const { id } = await json<{ id: string }>(res)
    expect(await domains()).toMatchObject([{ id, domain: 'mail.example.com', enabled: true, mailboxCount: 0 }])

    expect((await api(`/api/admin/domains/${id}`, { cookie: admin, method: 'PATCH', body: { enabled: false } })).status).toBe(204)
    expect((await domains())[0]!.enabled).toBe(false)
    expect((await api(`/api/admin/domains/${id}`, { cookie: admin, method: 'PATCH', body: { enabled: true } })).status).toBe(204)

    const audit = await env.DB.prepare("SELECT detail FROM audit_logs WHERE action LIKE 'admin.domain_%'").all<{ detail: string }>()
    expect(audit.results).toHaveLength(3)
    for (const row of audit.results) expect(JSON.parse(row.detail)).toMatchObject({ domain: 'mail.example.com' })
  })

  it('rejects invalid and duplicate domains', async () => {
    expect((await api('/api/admin/domains', { cookie: admin, body: { domain: 'mail.xn--p1ai' } })).status).toBe(201)
    const tooLong = `${'a'.repeat(60)}.${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(40)}.com`
    for (const domain of ['localhost', 'no_underscore.com', '-lead.com', 'a..b.com', 'http://x.com', 'x.c', tooLong]) {
      expect((await api('/api/admin/domains', { cookie: admin, body: { domain } })).status, domain).toBe(400)
    }
    await api('/api/admin/domains', { cookie: admin, body: { domain: 'dup.test' } })
    const dup = await api('/api/admin/domains', { cookie: admin, body: { domain: 'DUP.test' } })
    expect(dup.status).toBe(409)
    expect(await json(dup)).toEqual({ error: 'domain_exists' })
  })

  it('deletes only domains that never had a mailbox', async () => {
    const unused = (await json<{ id: string }>(await api('/api/admin/domains', { cookie: admin, body: { domain: 'unused.test' } }))).id
    const used = (await json<{ id: string }>(await api('/api/admin/domains', { cookie: admin, body: { domain: 'used.test' } }))).id
    await createUser('carol')
    const carol = await login('carol')
    await api('/api/mailboxes', { cookie: carol, body: { domainId: used } })

    expect((await api(`/api/admin/domains/${unused}`, { cookie: admin, method: 'DELETE' })).status).toBe(204)
    const blocked = await api(`/api/admin/domains/${used}`, { cookie: admin, method: 'DELETE' })
    expect(blocked.status).toBe(409)
    expect(await json(blocked)).toEqual({ error: 'domain_in_use' })
    expect((await api('/api/admin/domains/nope', { cookie: admin, method: 'DELETE' })).status).toBe(404)
    expect((await domains()).map((d) => [d.domain, d.mailboxCount])).toEqual([['used.test', 1]])
  })

  it('keeps a domain with retired addresses from being deleted', async () => {
    const id = (await json<{ id: string }>(await api('/api/admin/domains', { cookie: admin, body: { domain: 'gone.test' } }))).id
    await env.DB.prepare("INSERT INTO retired_addresses (address, retired_at) VALUES ('old@gone.test', 1)").run()
    expect((await api(`/api/admin/domains/${id}`, { cookie: admin, method: 'DELETE' })).status).toBe(409)
  })
})
