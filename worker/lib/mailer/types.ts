/** What a provider sends: plain text from one of the user's own addresses (v1). */
export interface OutgoingMail {
  from: string
  to: string[]
  subject: string
  text: string
  /** Threading headers for replies (In-Reply-To, References). */
  headers?: Record<string, string>
  /** Same key → the provider sends at most once (double clicks, retries). */
  idempotencyKey: string
}

/**
 * Why a send failed. `refund` says whether the message certainly did not go out, so the user's
 * quota can be given back; on timeouts and 5xx it may have been sent, so it stays counted.
 */
export type SendErrorCode = 'provider_not_configured' | 'provider_rejected' | 'provider_rate_limited' | 'provider_unavailable'

export type SendResult = { ok: true; id: string } | { ok: false; error: SendErrorCode; refund: boolean }

/** Whether the provider will send from a domain (verified on its side). */
export type DomainSendStatus = 'verified' | 'unverified' | 'unknown'

export interface Mailer {
  readonly name: string
  /** False when a required secret is missing; the admin panel shows it. */
  readonly configured: boolean
  send(mail: OutgoingMail): Promise<SendResult>
  domainStatus(domain: string): Promise<DomainSendStatus>
}
