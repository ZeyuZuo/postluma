/**
 * Sender authentication as Cloudflare Email Routing saw it (SPF / DKIM / DMARC).
 *
 * Email Routing prepends an `ARC-Authentication-Results` header naming itself (`mx.cloudflare.net`)
 * as the authserv-id. Anyone can write such a header into a message, so only the topmost one is
 * read: Cloudflare's is added above everything the sender wrote. A topmost header from any other
 * authserv-id (a forwarder upstream, or a forgery when Cloudflare added none) yields null — never a
 * guess. Deployments opt in with SENDER_AUTH_HINTS once a real message confirmed the header.
 */
import type { SenderAuth } from '../../shared/api'

export const CLOUDFLARE_AUTHSERV_ID = 'mx.cloudflare.net'
const HEADER = 'arc-authentication-results'
const RESULTS = new Set(['pass', 'fail', 'softfail', 'neutral', 'none', 'temperror', 'permerror', 'policy'])
const METHODS = ['spf', 'dkim', 'dmarc'] as const
const MAX_VALUE_CHARS = 4_000

/** Drops RFC 5322 comments, e.g. "(mx.cloudflare.net: domain of … designates …)". */
const stripComments = (value: string) => value.replace(/\([^()]*\)/g, ' ')

export function parseSenderAuth(headers: { key: string; value: string }[]): SenderAuth | null {
  const top = headers.find((h) => h.key === HEADER)
  if (!top) return null
  const [instance, authservId, ...parts] = stripComments(top.value.slice(0, MAX_VALUE_CHARS)).split(';').map((p) => p.trim())
  if (!/^i\s*=\s*\d+$/i.test(instance ?? '')) return null
  if (authservId?.split(/\s+/)[0]?.toLowerCase() !== CLOUDFLARE_AUTHSERV_ID) return null

  const found: SenderAuth = { spf: null, dkim: null, dmarc: null }
  for (const part of parts) {
    const m = /^([a-z]+)\s*=\s*([a-z]+)\b/i.exec(part)
    if (!m) continue
    const method = m[1]!.toLowerCase() as (typeof METHODS)[number]
    const result = m[2]!.toLowerCase()
    if (!METHODS.includes(method) || !RESULTS.has(result)) continue
    // Several DKIM signatures: one passing is enough.
    if (found[method] === null || (method === 'dkim' && result === 'pass')) found[method] = result
  }
  return found.spf || found.dkim || found.dmarc ? found : null
}

/** Stored compactly in messages.auth_results, e.g. "spf=pass;dkim=pass;dmarc=pass". */
export function encodeSenderAuth(auth: SenderAuth | null): string | null {
  if (!auth) return null
  const parts = METHODS.filter((m) => auth[m]).map((m) => `${m}=${auth[m]}`)
  return parts.length ? parts.join(';') : null
}

export function decodeSenderAuth(stored: string | null): SenderAuth | null {
  if (!stored) return null
  const auth: SenderAuth = { spf: null, dkim: null, dmarc: null }
  for (const part of stored.split(';')) {
    const [method, result] = part.split('=')
    if (METHODS.includes(method as (typeof METHODS)[number]) && result && RESULTS.has(result)) {
      auth[method as (typeof METHODS)[number]] = result
    }
  }
  return auth.spf || auth.dkim || auth.dmarc ? auth : null
}
