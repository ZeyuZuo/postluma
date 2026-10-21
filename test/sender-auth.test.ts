import { describe, expect, it } from 'vitest'

import type { SenderAuth } from '../shared/api'
import { decodeSenderAuth, encodeSenderAuth, parseSenderAuth } from '../worker/lib/sender-auth'

const arc = (value: string) => ({ key: 'arc-authentication-results', value })
const other = (key: string, value: string) => ({ key, value })
const CF_PASS =
  'i=1; mx.cloudflare.net; dkim=pass header.d=example.com header.s=s1 header.b=AbCd; dmarc=pass header.from=example.com policy.dmarc=reject; spf=pass (mx.cloudflare.net: domain of bounce@example.com designates 192.0.2.1 as permitted sender) smtp.mailfrom=bounce@example.com'

const cases: [label: string, headers: { key: string; value: string }[], expected: SenderAuth | null][] = [
  ['cloudflare pass', [arc(CF_PASS)], { spf: 'pass', dkim: 'pass', dmarc: 'pass' }],
  ['cloudflare fail', [arc('i=1; mx.cloudflare.net; dkim=none; dmarc=fail header.from=bank.example; spf=softfail smtp.mailfrom=x@evil.example')], { spf: 'softfail', dkim: 'none', dmarc: 'fail' }],
  ['after an upstream forwarder (i=2)', [arc(CF_PASS.replace('i=1', 'i=2')), arc('i=1; mx.google.com; dkim=pass; spf=pass; dmarc=pass')], { spf: 'pass', dkim: 'pass', dmarc: 'pass' }],
  ['one of two DKIM signatures passes', [arc('i=1; mx.cloudflare.net; dkim=fail header.d=a.example; dkim=pass header.d=b.example; dmarc=pass')], { spf: null, dkim: 'pass', dmarc: 'pass' }],
  ['other headers above are fine', [other('received', 'from x by mx.cloudflare.net'), other('arc-seal', 'i=1; a=rsa-sha256'), arc(CF_PASS)], { spf: 'pass', dkim: 'pass', dmarc: 'pass' }],
  ['authserv-id is case-insensitive', [arc(CF_PASS.replace('mx.cloudflare.net;', 'MX.Cloudflare.NET;'))], { spf: 'pass', dkim: 'pass', dmarc: 'pass' }],
  // Never trusted
  ['no header', [other('subject', 'Hello')], null],
  ['topmost from another server', [arc('i=1; mx.google.com; dkim=pass; spf=pass; dmarc=pass'), arc(CF_PASS)], null],
  ['lookalike authserv-id', [arc(CF_PASS.replace('mx.cloudflare.net;', 'mx.cloudflare.net.evil.example;'))], null],
  ['plain Authentication-Results is ignored', [other('authentication-results', 'mx.cloudflare.net; dkim=pass; spf=pass; dmarc=pass')], null],
  ['missing instance', [arc('mx.cloudflare.net; dkim=pass; spf=pass; dmarc=pass')], null],
  ['unknown result words', [arc('i=1; mx.cloudflare.net; dkim=trustme; dmarc=verified')], null],
]

describe('parseSenderAuth', () => {
  it.each(cases)('%s', (_label, headers, expected) => {
    expect(parseSenderAuth(headers)).toEqual(expected)
  })

  it('round-trips through the stored form', () => {
    const auth = parseSenderAuth([arc(CF_PASS)])
    expect(encodeSenderAuth(auth)).toBe('spf=pass;dkim=pass;dmarc=pass')
    expect(decodeSenderAuth(encodeSenderAuth(auth))).toEqual(auth)
    expect(decodeSenderAuth('dmarc=junk;spf=')).toBeNull()
  })
})
