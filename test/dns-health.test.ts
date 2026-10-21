import { afterEach, describe, expect, it, vi } from 'vitest'

import type { DomainHealth, MxStatus } from '../shared/api'
import { DOH_URL, assessMx, checkDomainMx } from '../worker/lib/dns-health'
import { api, createUser, json, login } from './helpers'

const mx = (data: string) => ({ type: 15, data })

const cases: [label: string, answers: { type: number; data: string }[], status: MxStatus][] = [
  ['all three Cloudflare routes', [mx('86 route3.mx.cloudflare.net.'), mx('13 route1.mx.cloudflare.net.'), mx('24 route2.mx.cloudflare.net.')], 'ok'],
  ['upper case, no trailing dot', [mx('10 ROUTE1.MX.CLOUDFLARE.NET')], 'ok'],
  ['mixed with another provider', [mx('10 route1.mx.cloudflare.net.'), mx('20 mx.zoho.com.')], 'partial'],
  ['another provider only', [mx('1 aspmx.l.google.com.'), mx('5 alt1.aspmx.l.google.com.')], 'other'],
  ['lookalike host', [mx('10 mx.cloudflare.net.evil.example.')], 'other'],
  ['null MX (RFC 7505)', [mx('0 .')], 'none'],
  ['no records', [], 'none'],
  ['only a CNAME in the answer', [{ type: 5, data: 'other.example.' }], 'none'],
]

describe('assessMx', () => {
  it.each(cases)('%s', (_label, answers, status) => {
    expect(assessMx(answers).status).toBe(status)
  })

  it('lists records by priority, host lowercased without the trailing dot', () => {
    expect(assessMx([mx('20 B.example.'), mx('10 a.example.')]).mx).toEqual([
      { priority: 10, host: 'a.example' },
      { priority: 20, host: 'b.example' },
    ])
  })
})

describe('checkDomainMx', () => {
  afterEach(() => vi.restoreAllMocks())
  const reply = (body: unknown, status = 200) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

  it('asks Cloudflare DoH for the MX records', async () => {
    const spy = reply({ Status: 0, Answer: [mx('10 route1.mx.cloudflare.net.')] })
    expect((await checkDomainMx('mail.example.com', 1)).status).toBe('ok')
    expect(String(spy.mock.calls[0]![0])).toBe(`${DOH_URL}?name=mail.example.com&type=MX`)
  })

  it('treats NXDOMAIN as no MX and anything else as an error', async () => {
    reply({ Status: 3 })
    expect((await checkDomainMx('nope.example', 1)).status).toBe('none')
    vi.restoreAllMocks()
    reply({ Status: 2 })
    expect((await checkDomainMx('x.example', 1)).status).toBe('error')
    vi.restoreAllMocks()
    reply({}, 500)
    expect((await checkDomainMx('x.example', 1)).status).toBe('error')
    vi.restoreAllMocks()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    expect((await checkDomainMx('x.example', 1)).status).toBe('error')
  })
})

describe('GET /api/admin/domains/:id/health', () => {
  afterEach(() => vi.restoreAllMocks())

  it('checks a domain for admins only; unknown ids are 404', async () => {
    const admin = await login('admin', 'test-admin-password')
    const { id } = await json<{ id: string }>(await api('/api/admin/domains', { cookie: admin, body: { domain: 'mail.example.com' } }))
    const realFetch = globalThis.fetch
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      String(input instanceof Request ? input.url : input).startsWith(DOH_URL)
        ? Promise.resolve(new Response(JSON.stringify({ Status: 0, Answer: [mx('10 route1.mx.cloudflare.net.')] })))
        : realFetch(input, init),
    )

    const res = await api(`/api/admin/domains/${id}/health`, { cookie: admin })
    expect(res.status).toBe(200)
    expect((await json<{ health: DomainHealth }>(res)).health).toMatchObject({ status: 'ok', mx: [{ host: 'route1.mx.cloudflare.net' }] })
    expect((await api('/api/admin/domains/missing/health', { cookie: admin })).status).toBe(404)

    await createUser('alice')
    const user = await login('alice')
    expect([403, 404]).toContain((await api(`/api/admin/domains/${id}/health`, { cookie: user })).status)
    expect((await api(`/api/admin/domains/${id}/health`)).status).toBe(401)
  })
})
