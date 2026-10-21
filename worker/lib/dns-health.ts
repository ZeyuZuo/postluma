/**
 * Domain health for the admin page: does the domain's MX point at Cloudflare Email Routing?
 * Looked up over DNS-over-HTTPS (Cloudflare's resolver, JSON API) — one subrequest, no CPU to speak of.
 * A domain whose MX points elsewhere (or nowhere) silently never reaches this Worker.
 */
import type { DomainHealth, MxStatus } from '../../shared/api'

export const DOH_URL = 'https://cloudflare-dns.com/dns-query'
const CLOUDFLARE_MX = /(^|\.)mx\.cloudflare\.net$/i
const MX_TYPE = 15
const NXDOMAIN = 3
const TIMEOUT_MS = 5_000
const MAX_RECORDS = 20

interface DohAnswer {
  type: number
  data: string
}
interface DohResponse {
  Status: number
  Answer?: DohAnswer[]
}

/** Classifies MX records ("10 route1.mx.cloudflare.net.") — pure, for table-driven tests. */
export function assessMx(answers: DohAnswer[]): Pick<DomainHealth, 'status' | 'mx'> {
  const mx = answers
    .filter((a) => a.type === MX_TYPE)
    .slice(0, MAX_RECORDS)
    .map((a) => {
      const [priority, host = ''] = a.data.trim().split(/\s+/)
      return { priority: Number(priority) || 0, host: host.replace(/\.$/, '').toLowerCase() }
    })
    // RFC 7505 null MX ("0 .") means "accepts no mail".
    .filter((r) => r.host !== '')
    .sort((a, b) => a.priority - b.priority)
  const cloudflare = mx.filter((r) => CLOUDFLARE_MX.test(r.host)).length
  let status: MxStatus
  if (mx.length === 0) status = 'none'
  else if (cloudflare === mx.length) status = 'ok'
  else if (cloudflare > 0) status = 'partial'
  else status = 'other'
  return { status, mx }
}

export async function checkDomainMx(domain: string, now = Date.now()): Promise<DomainHealth> {
  const url = `${DOH_URL}?name=${encodeURIComponent(domain)}&type=MX`
  try {
    const res = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!res.ok) throw new Error(`DoH HTTP ${res.status}`)
    const body = (await res.json()) as DohResponse
    if (body.Status === NXDOMAIN) return { status: 'none', mx: [], checkedAt: now }
    if (body.Status !== 0) throw new Error(`DoH status ${body.Status}`)
    return { ...assessMx(body.Answer ?? []), checkedAt: now }
  } catch (err) {
    console.warn('MX check failed', domain, err instanceof Error ? err.message : err)
    return { status: 'error', mx: [], checkedAt: now }
  }
}
