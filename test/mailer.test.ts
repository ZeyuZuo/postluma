import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getConfig } from '../worker/lib/config'
import { getMailer } from '../worker/lib/mailer'
import { RESEND_API, resendMailer } from '../worker/lib/mailer/resend'

const mail = { from: 'Me <me@mail.test>', to: ['you@example.org'], subject: 'Hi', text: 'Hello', idempotencyKey: 'k1' }
// A fresh Response per call: a body can only be read once.
const reply = (status: number, body: unknown = {}) =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify(body), { status }))

afterEach(() => vi.restoreAllMocks())

describe('resend mailer', () => {
  it('posts the message with the key and an idempotency key', async () => {
    const spy = reply(200, { id: 're_123' })
    expect(await resendMailer('re_key').send({ ...mail, headers: { 'In-Reply-To': '<a@b>' } })).toEqual({ ok: true, id: 're_123' })
    const [url, init] = spy.mock.calls[0]!
    expect(url).toBe(`${RESEND_API}/emails`)
    const headers = init!.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer re_key')
    expect(headers['idempotency-key']).toBe('k1')
    expect(JSON.parse(String(init!.body))).toEqual({ from: mail.from, to: mail.to, subject: 'Hi', text: 'Hello', headers: { 'In-Reply-To': '<a@b>' } })
  })

  it.each([
    [422, 'provider_rejected', true],
    [429, 'provider_rate_limited', true],
    [401, 'provider_not_configured', true],
    [500, 'provider_unavailable', false],
  ] as const)('maps HTTP %i to %s (refund %s)', async (status, error, refund) => {
    reply(status, { message: 'nope' })
    expect(await resendMailer('re_key').send(mail)).toEqual({ ok: false, error, refund })
  })

  it('keeps the quota on timeouts (the mail may have gone out) and refuses without a key', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('timeout'))
    expect(await resendMailer('re_key').send(mail)).toEqual({ ok: false, error: 'provider_unavailable', refund: false })
    const unconfigured = resendMailer('  ')
    expect(unconfigured.configured).toBe(false)
    expect(await unconfigured.send(mail)).toEqual({ ok: false, error: 'provider_not_configured', refund: true })
  })

  it('reports whether a domain is verified on Resend', async () => {
    reply(200, { data: [{ name: 'mail.test', status: 'verified' }, { name: 'other.test', status: 'pending' }] })
    const resend = resendMailer('re_key')
    expect(await resend.domainStatus('MAIL.test')).toBe('verified')
    expect(await resend.domainStatus('other.test')).toBe('unverified')
    expect(await resend.domainStatus('missing.test')).toBe('unverified')
    vi.restoreAllMocks()
    reply(500)
    expect(await resend.domainStatus('mail.test')).toBe('unknown')
  })
})

describe('getMailer', () => {
  it('follows MAIL_PROVIDER', () => {
    expect(getMailer(env, getConfig(env)).name).toBe('log')
    const resendEnv = { ...env, MAIL_PROVIDER: 'resend', RESEND_API_KEY: 'k' } as unknown as Env
    expect(getMailer(resendEnv, getConfig(resendEnv))).toMatchObject({ name: 'resend', configured: true })
  })
})
