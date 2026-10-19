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
  })
  .refine((v) => v.note !== undefined || v.status !== undefined)

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
