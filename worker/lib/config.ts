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
  }
  /** 0 = keep forever. */
  retentionDays: number
  /** Messages deletable per UTC day across retention cleanup, user purges and manual cleanups. */
  maxDeletesPerDay: number
  /**
   * Longest retention that fits the database: INGEST_MAX_MB_PER_DAY × days ≤ 80 % of 500 MB.
   * Admin overrides beyond this (or 0 = forever) are refused.
   */
  maxRetentionDays: number
}

const DAY_MS = 24 * 60 * 60 * 1000
/** 80 % of the Free plan's 500 MB D1 limit, leaving room for indexes and other tables. */
const DB_BUDGET_BYTES = 0.8 * 500 * 1024 * 1024
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

function readBool(env: Env, name: 'REGISTRATION_OPEN', fallback: boolean): boolean {
  const raw = (env as unknown as Record<string, unknown>)[name]
  if (raw === undefined || raw === '') return fallback
  if (raw === 'true' || raw === true) return true
  if (raw === 'false' || raw === false) return false
  warnOnce(name, raw, fallback)
  return fallback
}

export function getConfig(env: Env): AppConfig {
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
      bytesPerDay: readInt(env, 'INGEST_MAX_MB_PER_DAY') * 1024 * 1024,
      parseWindowBytes: readInt(env, 'INGEST_PARSE_WINDOW_KB') * 1024,
    },
    retentionDays: readInt(env, 'MESSAGE_RETENTION_DAYS'),
    maxDeletesPerDay: readInt(env, 'MAX_DELETES_PER_DAY'),
    maxRetentionDays: Math.max(1, Math.floor(DB_BUDGET_BYTES / (readInt(env, 'INGEST_MAX_MB_PER_DAY') * 1024 * 1024))),
  }
}
