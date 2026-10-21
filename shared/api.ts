/**
 * Types and validation schemas shared by the Worker API and the Vue client.
 * Error codes are stable identifiers; the client maps them to translated messages.
 */
import { z } from 'zod'

export const SUPPORTED_LOCALES = ['zh-CN', 'en'] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]

export const ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'not_found',
  'bad_origin',
  'invalid_input',
  'rate_limited',
  'turnstile_failed',
  'registration_closed',
  'username_taken',
  'invalid_credentials',
  'account_pending',
  'account_rejected',
  'account_banned',
  'internal_error',
  'payload_too_large',
  'invalid_local_part',
  'address_taken',
  'domain_unavailable',
  'mailbox_quota_exceeded',
  'mailbox_total_limit_reached',
  'domain_exists',
  'domain_in_use',
  'invalid_state',
  'cannot_modify_admin',
  'user_has_messages',
  'retention_too_long',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export interface ApiErrorBody {
  error: ErrorCode
}

export type UserRole = 'user' | 'admin'
export type UserStatus = 'pending' | 'active' | 'rejected' | 'banned'

export interface PublicUser {
  id: string
  username: string
  role: UserRole
  status: UserStatus
  locale: Locale | null
  createdAt: number
}

export interface PublicSettings {
  registrationOpen: boolean
}

export const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]+$/
export const USERNAME_MIN = 3
export const USERNAME_MAX = 32
export const PASSWORD_MIN = 8
export const PASSWORD_MAX = 128

const usernameSchema = z.string().trim().min(USERNAME_MIN).max(USERNAME_MAX).regex(USERNAME_PATTERN)
const newPasswordSchema = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)
const turnstileTokenSchema = z.string().max(4096).optional()

export const registerSchema = z.object({
  username: usernameSchema,
  password: newPasswordSchema,
  turnstileToken: turnstileTokenSchema,
})

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(PASSWORD_MAX),
  turnstileToken: turnstileTokenSchema,
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(PASSWORD_MAX),
  newPassword: newPasswordSchema,
})

export const updateProfileSchema = z.object({
  locale: z.enum(SUPPORTED_LOCALES).nullable(),
})

// ---- Mailboxes & domains -------------------------------------------------------------------

export type MailboxStatus = 'active' | 'disabled'

export interface PublicDomain {
  id: string
  domain: string
}

export interface AdminDomain extends PublicDomain {
  enabled: boolean
  mailboxCount: number
  createdAt: number
}

export interface PublicMailbox {
  id: string
  address: string
  domain: string
  note: string | null
  status: MailboxStatus
  /** Also receive mail sent to `local+anything@domain`. Off by default. */
  acceptSubaddress: boolean
  /** Both counts stop at MAILBOX_COUNT_CAP (shown as "99+"). */
  messageCount: number
  unreadCount: number
  createdAt: number
  lastReceivedAt: number | null
}

export interface MailboxQuota {
  /** Active mailboxes; disabled ones don't count. */
  used: number
  limit: number
}

export interface MailboxListResponse {
  items: PublicMailbox[]
  nextCursor: string | null
  quota: MailboxQuota
}

/** Lowercase letters/digits, inner `.`, `_`, `-` allowed, no leading/trailing/double punctuation. */
export const LOCAL_PART_PATTERN = /^[a-z0-9](?:[a-z0-9]|[._-](?=[a-z0-9]))*$/
export const LOCAL_PART_MIN = 3
export const LOCAL_PART_MAX = 32
export const NOTE_MAX = 200
/** RFC 2142 role accounts and other names that must never belong to an ordinary user. */
export const RESERVED_LOCAL_PARTS: readonly string[] = [
  'abuse', 'admin', 'administrator', 'billing', 'contact', 'hostmaster', 'info', 'mailer-daemon', 'noc',
  'no-reply', 'noreply', 'postmaster', 'root', 'security', 'support', 'webmaster',
]

export function normalizeLocalPart(value: string): string {
  return value.trim().toLowerCase()
}

export function isValidLocalPart(value: string): boolean {
  return (
    value.length >= LOCAL_PART_MIN &&
    value.length <= LOCAL_PART_MAX &&
    LOCAL_PART_PATTERN.test(value) &&
    !RESERVED_LOCAL_PARTS.includes(value)
  )
}

/**
 * Max 221 chars so a full address (32-char local part + "@") stays within RFC 5321's 254.
 * The TLD may be alphabetic or punycode (xn--…).
 */
export const DOMAIN_PATTERN = /^(?=.{4,221}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/

const idSchema = z.string().min(1).max(64)
// Control characters and bidi overrides could spoof how an address/note reads; drop them.
const UNSAFE_TEXT = /[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu

/** Removes control and bidi-override characters from attacker-controlled display text. */
export function stripUnsafeText(value: string): string {
  return value.replace(UNSAFE_TEXT, '')
}
const noteSchema = z
  .string()
  .max(NOTE_MAX * 2)
  .transform((v) => stripUnsafeText(v).trim())
  .pipe(z.string().max(NOTE_MAX))
  .transform((v) => (v === '' ? null : v))

export const createMailboxSchema = z.object({
  domainId: idSchema,
  /** Omit for a random address. */
  localPart: z.string().max(64).optional(),
  note: noteSchema.optional(),
})

export const updateMailboxSchema = z
  .object({
    note: noteSchema.nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
    acceptSubaddress: z.boolean().optional(),
  })
  .refine((v) => v.note !== undefined || v.status !== undefined || v.acceptSubaddress !== undefined)

export const listMailboxesQuerySchema = z.object({
  status: z.enum(['active', 'disabled']).default('active'),
  q: z.string().trim().max(100).optional(),
  cursor: z.string().max(200).optional(),
})

export const createDomainSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(DOMAIN_PATTERN),
})

export const updateDomainSchema = z.object({ enabled: z.boolean() })

// ---- Messages ------------------------------------------------------------------------------

export interface MessageSummary {
  id: string
  mailboxId: string
  mailboxAddress: string
  /** The owner's own note on the receiving address ("which site is this for"). */
  mailboxNote: string | null
  mailboxStatus: MailboxStatus
  fromAddress: string
  fromName: string | null
  subject: string
  snippet: string
  verificationCode: string | null
  /** https link to verify / confirm / sign in, detected at delivery. Attacker-controlled. */
  verificationLink: string | null
  isRead: boolean
  hasAttachments: boolean
  receivedAt: number
}

export interface MessageAttachment {
  filename: string | null
  contentType: string
  size: number
  inline: boolean
}

/**
 * SPF / DKIM / DMARC results recorded by Cloudflare Email Routing (`pass`, `fail`, `softfail`, …).
 * Only DMARC `pass` means the From domain is genuine; the rest is detail.
 */
export interface SenderAuth {
  spf: string | null
  dkim: string | null
  dmarc: string | null
}

export interface MessageDetail extends MessageSummary {
  toAddress: string
  /** SMTP envelope sender: who actually delivered it (often a mailing service, not the From domain). */
  envelopeFrom: string | null
  textBody: string | null
  /** Raw, attacker-controlled HTML. Only ever render it through the sandboxed mail frame. */
  htmlBody: string | null
  isTruncated: boolean
  size: number
  /**
   * From the parse window, so possibly incomplete when `isTruncated`. With `hasRaw`, the client gets
   * the complete list (and the content) by parsing GET /api/messages/:id/raw.
   */
  attachments: MessageAttachment[]
  /** The original message is kept in R2 and can be downloaded. */
  hasRaw: boolean
  /** Null when the deployment doesn't record it (SENDER_AUTH_HINTS) or nothing trustworthy was found. */
  senderAuth: SenderAuth | null
}

export interface MessageListResponse {
  items: MessageSummary[]
  nextCursor: string | null
}

export interface InboxSummary {
  /**
   * Unread messages in active mailboxes, counted up to UNREAD_COUNT_CAP. `null` when the caller
   * passed `known` equal to the latest arrival (nothing new; the count was not recomputed).
   */
  unread: number | null
  latestReceivedAt: number | null
}

/** Badges show "99+"; counting further would only cost D1 reads. */
export const UNREAD_COUNT_CAP = 100
/** Per-mailbox message/unread counts in mailbox listings stop here, for the same reason. */
export const MAILBOX_COUNT_CAP = 100
/** Search looks at this many of the user's newest messages (bounded D1 reads). */
export const SEARCH_WINDOW = 2_000
export const SEARCH_MIN_CHARS = 2
/** "Mark all read" updates at most this many rows per call (bounded D1 writes). */
export const MARK_READ_BATCH = 500

export const MESSAGE_PAGE_SIZE = 50

const flagSchema = z.enum(['1']).optional()

export const listMessagesQuerySchema = z.object({
  mailbox: idSchema.optional(),
  q: z.string().trim().min(SEARCH_MIN_CHARS).max(100).optional(),
  cursor: z.string().max(200).optional(),
  /** Only messages received after this timestamp (polling; also bounds the home "recent codes"). */
  since: z.coerce.number().int().min(0).optional(),
  unread: flagSchema,
  /** Only messages with a detected verification code. */
  code: flagSchema,
  limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE_SIZE).default(MESSAGE_PAGE_SIZE),
})

export const updateMessageSchema = z.object({ isRead: z.boolean() })

export const markReadSchema = z.object({ mailboxId: idSchema.optional() })

export const summaryQuerySchema = z.object({
  /** The latest arrival the client already knows about; if unchanged, the count is skipped. */
  known: z.coerce.number().int().min(0).optional(),
  /** Force a recount (clients do this every few minutes to correct local drift). */
  recount: z.enum(['1']).optional(),
})

// ---- Admin ---------------------------------------------------------------------------------
// Admin endpoints return account metadata and aggregate numbers only — never addresses' mail,
// subjects, senders or bodies (product decision: admins can't read users' mail).

export interface AdminUser {
  id: string
  username: string
  role: UserRole
  status: UserStatus
  /** Per-user override; null = the effective default. */
  mailboxQuota: number | null
  activeMailboxes: number
  totalMailboxes: number
  createdAt: number
  lastLoginAt: number | null
}

export interface AdminUserListResponse {
  items: AdminUser[]
  nextCursor: string | null
  /** Pending sign-ups, for the tab badge (first page only; null on later pages). */
  pendingCount: number | null
}

export type AdminUserAction = 'approve' | 'reject' | 'ban' | 'unban'

/** Ranges shared by the admin UI and the API; they match worker/lib/config.ts. */
export const SETTING_RANGES = {
  defaultMailboxQuota: { min: 0, max: 10_000 },
  retentionDays: { min: 1, max: 3_650 },
  mailboxQuota: { min: 0, max: 10_000 },
} as const

export interface AdminSettings {
  /** Longest retention the database can hold at the configured daily intake (see config). */
  maxRetentionDays: number
  registrationOpen: boolean
  defaultMailboxQuota: number
  retentionDays: number
  /** Which values are admin overrides (vs. the deploy-time defaults in `defaults`). */
  overridden: { registrationOpen: boolean; defaultMailboxQuota: boolean; retentionDays: boolean }
  defaults: { registrationOpen: boolean; defaultMailboxQuota: number; retentionDays: number }
}

export interface AdminStats {
  users: Record<UserStatus, number>
  mailboxes: { active: number; disabled: number }
  /** Last 7 UTC days, oldest first (from the ingest counters, not by counting messages). */
  intake: { day: string; messages: number; bytes: number }[]
  today: { messages: number; bytes: number; maxMessages: number; maxBytes: number }
  database: { bytes: number | null; limitBytes: number }
}

export interface AuditEntry {
  id: string
  action: string
  actorUsername: string | null
  targetId: string | null
  /** Resolved when the target is a (still existing) user account. */
  targetUsername: string | null
  detail: unknown
  ip: string | null
  createdAt: number
}

export interface AuditListResponse {
  items: AuditEntry[]
  nextCursor: string | null
}

/** Deletions run in bounded batches (D1 write budget); clients repeat while `done` is false. */
export interface BatchDeleteResponse {
  deleted: number
  done: boolean
  /** Today's shared deletion budget (MAX_DELETES_PER_DAY) is spent; continue after 00:00 UTC. */
  budgetExhausted: boolean
}

export const adminUsersQuerySchema = z.object({
  status: z.enum(['pending', 'active', 'banned', 'rejected']).optional(),
  q: z.string().trim().max(64).optional(),
  cursor: z.string().max(200).optional(),
})

export const adminUserActionSchema = z.object({ action: z.enum(['approve', 'reject', 'ban', 'unban']) })

export const adminUserQuotaSchema = z.object({
  mailboxQuota: z.number().int().min(SETTING_RANGES.mailboxQuota.min).max(SETTING_RANGES.mailboxQuota.max).nullable(),
})

/** Each field: a value to override, `null` to go back to the deploy-time default, absent = keep. */
export const adminSettingsSchema = z
  .object({
    registrationOpen: z.boolean().nullable().optional(),
    defaultMailboxQuota: z
      .number()
      .int()
      .min(SETTING_RANGES.defaultMailboxQuota.min)
      .max(SETTING_RANGES.defaultMailboxQuota.max)
      .nullable()
      .optional(),
    retentionDays: z.number().int().min(SETTING_RANGES.retentionDays.min).max(SETTING_RANGES.retentionDays.max).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0)

export const adminCleanupSchema = z.object({ olderThanDays: z.number().int().min(1).max(3_650) })

export const auditQuerySchema = z.object({ cursor: z.string().max(200).optional() })
