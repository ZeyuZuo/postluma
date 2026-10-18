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
