/**
 * Deploy-time configuration from `wrangler.jsonc#vars` (edit there and redeploy; dashboard edits
 * are overwritten by the next deploy). Every value is validated: out-of-range or non-numeric
 * values fall back to the default and log a warning instead of breaking the service.
 *
 * Three of these are only *defaults*: an admin can override `REGISTRATION_OPEN`,
 * `DEFAULT_MAILBOX_QUOTA` and `MESSAGE_RETENTION_DAYS` at runtime (stored in the `settings` table).
 */

interface IntSpec {
  fallback: number
  min: number
  max: number
}

const INT_VARS = {
  PASSWORD_PBKDF2_ITERATIONS: { fallback: 20_000, min: 10_000, max: 100_000 },
  SESSION_TTL_DAYS: { fallback: 30, min: 1, max: 365 },
  DEFAULT_MAILBOX_QUOTA: { fallback: 10, min: 0, max: 10_000 },
  MAX_TOTAL_MAILBOXES: { fallback: 100, min: 1, max: 100_000 },
  MAX_DAILY_MAILBOX_CREATIONS: { fallback: 30, min: 1, max: 10_000 },
  INGEST_MAX_PER_MAILBOX_PER_HOUR: { fallback: 10, min: 1, max: 100_000 },
  INGEST_MAX_PER_USER_PER_HOUR: { fallback: 100, min: 1, max: 1_000_000 },
  INGEST_MAX_MESSAGES_PER_DAY: { fallback: 5_000, min: 1, max: 1_000_000 },
  INGEST_MAX_MB_PER_DAY: { fallback: 12, min: 1, max: 100_000 },
  INGEST_PARSE_WINDOW_KB: { fallback: 256, min: 64, max: 4_096 },
  MESSAGE_RETENTION_DAYS: { fallback: 30, min: 0, max: 3_650 },
  MAX_DELETES_PER_DAY: { fallback: 5_000, min: 100, max: 1_000_000 },
  RAW_MAIL_MAX_MB_PER_DAY: { fallback: 250, min: 0, max: 1_000_000 },
  SEND_MAX_PER_USER_PER_DAY: { fallback: 20, min: 0, max: 10_000 },
  SEND_MAX_PER_DAY: { fallback: 100, min: 0, max: 1_000_000 },
  SEND_MAX_RECIPIENTS: { fallback: 5, min: 1, max: 50 },
} satisfies Record<string, IntSpec>

type IntVar = keyof typeof INT_VARS

export interface AppConfig {
  registrationOpen: boolean
  passwordIterations: number
  sessionTtlMs: number
  defaultMailboxQuota: number
  maxTotalMailboxes: number
  maxDailyMailboxCreations: number
  ingest: {
    perMailboxPerHour: number
    perUserPerHour: number
    messagesPerDay: number
    bytesPerDay: number
    parseWindowBytes: number
    /** R2 bytes of original messages per UTC day; 0 = originals are not kept. */
    rawBytesPerDay: number
  }
  /** 0 = keep forever. */
  retentionDays: number
  /** Messages deletable per UTC day across retention cleanup, user purges and manual cleanups. */
  maxDeletesPerDay: number
  /**
   * Longest retention that fits the free tiers: INGEST_MAX_MB_PER_DAY × days ≤ 80 % of D1's 500 MB
   * and, when originals go to R2, RAW_MAIL_MAX_MB_PER_DAY × days ≤ 90 % of R2's 10 GB.
   * Admin overrides beyond this (or 0 = forever) are refused.
   */
  maxRetentionDays: number
  /** Record Cloudflare's SPF/DKIM/DMARC results with each message (see worker/lib/sender-auth.ts). */
  senderAuthHints: boolean
  sending: {
    /** Deploy-time default of the service-wide switch; admins override it (settings.sending_enabled). */
    enabled: boolean
    provider: MailProviderName
    perUserPerDay: number
    perDay: number
    maxRecipients: number
  }
}

export const MAIL_PROVIDERS = ['resend', 'log'] as const
export type MailProviderName = (typeof MAIL_PROVIDERS)[number]

const DAY_MS = 24 * 60 * 60 * 1000
/** 80 % of the Free plan's 500 MB D1 limit, leaving room for indexes and other tables. */
const DB_BUDGET_BYTES = 0.8 * 500 * 1024 * 1024
/** 90 % of the R2 free tier's 10 GB. */
const R2_BUDGET_BYTES = 0.9 * 10 * 1024 * 1024 * 1024
const MB = 1024 * 1024
const warned = new Set<string>()

function warnOnce(name: string, raw: unknown, fallback: unknown): void {
  if (warned.has(name)) return
  warned.add(name)
  console.warn(`Invalid ${name}=${JSON.stringify(raw)}; using ${JSON.stringify(fallback)}`)
}

function readInt(env: Env, name: IntVar): number {
  const spec: IntSpec = INT_VARS[name]
  const raw = (env as unknown as Record<string, unknown>)[name]
  if (raw === undefined || raw === '') return spec.fallback
  const value = Number(raw)
  if (Number.isInteger(value) && value >= spec.min && value <= spec.max) return value
  warnOnce(name, raw, spec.fallback)
  return spec.fallback
}

function readBool(env: Env, name: 'REGISTRATION_OPEN' | 'SENDER_AUTH_HINTS' | 'SENDING_ENABLED', fallback: boolean): boolean {
  const raw = (env as unknown as Record<string, unknown>)[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === true) return true
  if (raw === 'false' || raw === false) return false
  warnOnce(name, raw, fallback)
  return fallback
}

/** `log` records instead of sending: local development and e2e only. */
function readProvider(env: Env): MailProviderName {
  const raw = (env as unknown as Record<string, unknown>).MAIL_PROVIDER
  if (raw === undefined || raw === '') return 'resend'
  if (MAIL_PROVIDERS.includes(raw as MailProviderName)) return raw as MailProviderName
  warnOnce('MAIL_PROVIDER', raw, 'resend')
  return 'resend'
}

/** The R2 binding, if this deployment has one (it is optional; see wrangler.jsonc). */
export function mailBucket(env: Env): R2Bucket | null {
  return (env as { MAIL_BUCKET?: R2Bucket }).MAIL_BUCKET ?? null
}

export function getConfig(env: Env): AppConfig {
  const ingestMb = readInt(env, 'INGEST_MAX_MB_PER_DAY')
  const rawMb = mailBucket(env) ? readInt(env, 'RAW_MAIL_MAX_MB_PER_DAY') : 0
  const maxRetentionDays = Math.min(
    Math.floor(DB_BUDGET_BYTES / (ingestMb * MB)),
    rawMb > 0 ? Math.floor(R2_BUDGET_BYTES / (rawMb * MB)) : Infinity,
  )
  return {
    registrationOpen: readBool(env, 'REGISTRATION_OPEN', true),
    passwordIterations: readInt(env, 'PASSWORD_PBKDF2_ITERATIONS'),
    sessionTtlMs: readInt(env, 'SESSION_TTL_DAYS') * DAY_MS,
    defaultMailboxQuota: readInt(env, 'DEFAULT_MAILBOX_QUOTA'),
    maxTotalMailboxes: readInt(env, 'MAX_TOTAL_MAILBOXES'),
    maxDailyMailboxCreations: readInt(env, 'MAX_DAILY_MAILBOX_CREATIONS'),
    ingest: {
      perMailboxPerHour: readInt(env, 'INGEST_MAX_PER_MAILBOX_PER_HOUR'),
      perUserPerHour: readInt(env, 'INGEST_MAX_PER_USER_PER_HOUR'),
      messagesPerDay: readInt(env, 'INGEST_MAX_MESSAGES_PER_DAY'),
      bytesPerDay: ingestMb * MB,
      parseWindowBytes: readInt(env, 'INGEST_PARSE_WINDOW_KB') * 1024,
      rawBytesPerDay: rawMb * MB,
    },
    retentionDays: readInt(env, 'MESSAGE_RETENTION_DAYS'),
    maxDeletesPerDay: readInt(env, 'MAX_DELETES_PER_DAY'),
    maxRetentionDays: Math.max(1, maxRetentionDays),
    senderAuthHints: readBool(env, 'SENDER_AUTH_HINTS', false),
    sending: {
      enabled: readBool(env, 'SENDING_ENABLED', false),
      provider: readProvider(env),
      perUserPerDay: readInt(env, 'SEND_MAX_PER_USER_PER_DAY'),
      perDay: readInt(env, 'SEND_MAX_PER_DAY'),
      maxRecipients: readInt(env, 'SEND_MAX_RECIPIENTS'),
    },
  }
}
