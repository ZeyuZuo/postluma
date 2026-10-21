import type { DomainSendStatus, Mailer, OutgoingMail, SendResult } from './types'

export const RESEND_API = 'https://api.resend.com'
const TIMEOUT_MS = 10_000

/** Resend's REST API (https://resend.com/docs/api-reference/emails/send-email). */
export function resendMailer(apiKey: string | undefined): Mailer {
  const key = apiKey?.trim() ?? ''
  const auth = { authorization: `Bearer ${key}` }

  return {
    name: 'resend',
    configured: key !== '',

    async send(mail: OutgoingMail): Promise<SendResult> {
      if (!key) return { ok: false, error: 'provider_not_configured', refund: true }
      let res: Response
      try {
        res = await fetch(`${RESEND_API}/emails`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json', 'idempotency-key': mail.idempotencyKey },
          body: JSON.stringify({ from: mail.from, to: mail.to, subject: mail.subject, text: mail.text, headers: mail.headers }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        })
      } catch (err) {
        // Timed out or the connection dropped: it may still have been sent.
        console.warn('Resend send failed', err instanceof Error ? err.message : err)
        return { ok: false, error: 'provider_unavailable', refund: false }
      }
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { id?: unknown }
        return typeof body.id === 'string' ? { ok: true, id: body.id } : { ok: false, error: 'provider_unavailable', refund: false }
      }
      // Log the provider's reason for the operator; users only see a stable code.
      console.warn('Resend rejected a send', res.status, (await res.text().catch(() => '')).slice(0, 300))
      if (res.status === 429) return { ok: false, error: 'provider_rate_limited', refund: true }
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'provider_not_configured', refund: true }
      if (res.status >= 400 && res.status < 500) return { ok: false, error: 'provider_rejected', refund: true }
      return { ok: false, error: 'provider_unavailable', refund: false }
    },

    async domainStatus(domain: string): Promise<DomainSendStatus> {
      if (!key) return 'unknown'
      try {
        const res = await fetch(`${RESEND_API}/domains`, { headers: auth, signal: AbortSignal.timeout(TIMEOUT_MS) })
        if (!res.ok) return 'unknown'
        const body = (await res.json()) as { data?: { name?: string; status?: string }[] }
        const found = body.data?.find((d) => d.name?.toLowerCase() === domain.toLowerCase())
        return found?.status === 'verified' ? 'verified' : 'unverified'
      } catch {
        return 'unknown'
      }
    },
  }
}
