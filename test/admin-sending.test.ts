import { env } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AdminDomain, AdminSendingStatus, AdminUserListResponse } from '../shared/api'
import { RESEND_API } from '../worker/lib/mailer/resend'
import { addDomain, api, createUser, json, login } from './helpers'

let admin: string
let domainId: string
const resendEnv = { MAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test' }
const resendDomains = (data: unknown, status = 200) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
    String(input) === `${RESEND_API}/domains` ? new Response(JSON.stringify({ data }), { status }) : new Response('{}', { status: 500 }),
  )
const audits = async (action: string) =>
  (await env.DB.prepare('SELECT detail FROM audit_logs WHERE action = ?').bind(action).all<{ detail: string }>()).results.map((r) => JSON.parse(r.detail))

beforeEach(async () => {
  admin = await login('admin', 'test-admin-password')
  domainId = await addDomain('mail.test')
})
afterEach(() => vi.restoreAllMocks())

describe('admin sending controls', () => {
  it('are for admins only', async () => {
    await createUser('alice')
    const cookie = await login('alice')
    for (const req of [
      api('/api/admin/sending', { cookie }),
      api('/api/admin/sending', { cookie, method: 'PATCH', body: { enabled: true } }),
      api('/api/admin/sending/test', { cookie, body: { domainId, to: 'me@example.org' } }),
      api(`/api/admin/domains/${domainId}`, { cookie, method: 'PATCH', body: { canSend: true } }),
    ]) {
      expect([403, 404]).toContain((await req).status)
    }
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'sending_enabled'").first('n')).toBe(0)
  })

  it('switches sending on and back to the deploy default, with audit rows', async () => {
    const initial = await json<AdminSendingStatus>(await api('/api/admin/sending', { cookie: admin }))
    expect(initial).toMatchObject({ enabled: false, overridden: false, provider: 'log', configured: true, perDay: 100, usedToday: 0 })
    const on = await api('/api/admin/sending', { cookie: admin, method: 'PATCH', body: { enabled: true } })
    expect(await json<AdminSendingStatus>(on)).toMatchObject({ enabled: true, overridden: true })
    const reset = await api('/api/admin/sending', { cookie: admin, method: 'PATCH', body: { enabled: null } })
    expect(await json<AdminSendingStatus>(reset)).toMatchObject({ enabled: false, overridden: false })
    expect(await audits('admin.sending_update')).toEqual([{ enabled: true }, { enabled: null }])
  })

  it('reports an unconfigured Resend key', async () => {
    const res = await api('/api/admin/sending', { cookie: admin, env: { MAIL_PROVIDER: 'resend', RESEND_API_KEY: '' } })
    expect(await json<AdminSendingStatus>(res)).toMatchObject({ provider: 'resend', configured: false })
  })
})

describe('domain "can send"', () => {
  const patch = (canSend: boolean, extra: { env?: Record<string, string> } = {}) =>
    api(`/api/admin/domains/${domainId}`, { cookie: admin, method: 'PATCH', body: { canSend }, env: extra.env })
  const canSend = async () => (await json<{ items: AdminDomain[] }>(await api('/api/admin/domains', { cookie: admin }))).items[0]!.canSend

  it('switches on only when the provider has verified the domain', async () => {
    resendDomains([{ name: 'mail.test', status: 'pending' }])
    expect(await json(await patch(true, { env: resendEnv }))).toEqual({ error: 'send_domain_unverified' })
    vi.restoreAllMocks()
    resendDomains([], 500)
    expect(await json(await patch(true, { env: resendEnv }))).toEqual({ error: 'send_provider_unavailable' })
    expect(await canSend()).toBe(false)

    vi.restoreAllMocks()
    resendDomains([{ name: 'mail.test', status: 'verified' }])
    expect((await patch(true, { env: resendEnv })).status).toBe(204)
    expect(await canSend()).toBe(true)
    expect((await patch(false)).status).toBe(204) // switching off needs no check
    expect(await canSend()).toBe(false)
    expect(await audits('admin.domain_sending')).toEqual([{ domain: 'mail.test', canSend: true }, { domain: 'mail.test', canSend: false }])
  })
})

describe('user "can send"', () => {
  it('stores the permission and the quota override', async () => {
    const aliceId = await createUser('alice')
    const res = await api(`/api/admin/users/${aliceId}/sending`, { cookie: admin, method: 'PATCH', body: { canSend: true, sendQuota: 5 } })
    expect(res.status).toBe(204)
    const { items } = await json<AdminUserListResponse>(await api('/api/admin/users?status=active', { cookie: admin }))
    expect(items.find((u) => u.id === aliceId)).toMatchObject({ canSend: true, sendQuota: 5 })
    expect((await api('/api/admin/users/missing/sending', { cookie: admin, method: 'PATCH', body: { canSend: true, sendQuota: null } })).status).toBe(404)
    expect(await audits('admin.user_sending')).toEqual([{ canSend: true, sendQuota: 5 }])
  })
})

describe('test send', () => {
  it('needs a sending domain and reports the provider result', async () => {
    const body = { domainId, to: 'me@example.org' }
    expect((await api('/api/admin/sending/test', { cookie: admin, body })).status).toBe(404)
    await env.DB.prepare('UPDATE domains SET can_send = 1 WHERE id = ?').bind(domainId).run()
    expect(await json(await api('/api/admin/sending/test', { cookie: admin, body }))).toEqual({ ok: true })

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 422 }))
    const failed = await api('/api/admin/sending/test', { cookie: admin, body, env: resendEnv })
    expect(await json(failed)).toEqual({ ok: false, error: 'provider_rejected' })
    expect(await audits('admin.sending_test')).toEqual([
      { domain: 'mail.test', ok: true, error: null },
      { domain: 'mail.test', ok: false, error: 'provider_rejected' },
    ])
  })
})
