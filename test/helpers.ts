import { env, SELF } from 'cloudflare:test'

import { hashPassword } from '../worker/lib/password'
import { insertUser } from '../worker/repo/users'
import type { UserRole, UserStatus } from '../shared/api'

export const ORIGIN = 'https://postluma.test'
export const DEFAULT_PASSWORD = 'correct-horse-battery'

let ipCounter = 0
/** Distinct client IP per call so tests don't share rate-limit buckets. */
export function uniqueIp(): string {
  ipCounter += 1
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`
}

export interface ApiOptions {
  method?: string
  body?: unknown
  cookie?: string
  /** `null` omits the Origin header. */
  origin?: string | null
  ip?: string
}

export function api(path: string, opts: ApiOptions = {}): Promise<Response> {
  const headers = new Headers({ 'cf-connecting-ip': opts.ip ?? uniqueIp() })
  if (opts.body !== undefined) headers.set('content-type', 'application/json')
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
}

export async function createUser(
  username: string,
  opts: { password?: string; status?: UserStatus; role?: UserRole } = {},
): Promise<string> {
  return insertUser(env.DB, {
    username,
    passwordHash: await hashPassword(opts.password ?? DEFAULT_PASSWORD),
    role: opts.role ?? 'user',
    status: opts.status ?? 'active',
  })
}

/** Logs in and returns the `name=value` pair to send back as a Cookie header. */
export async function login(username: string, password = DEFAULT_PASSWORD): Promise<string> {
  const res = await api('/api/auth/login', { body: { username, password } })
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${await res.text()}`)
  return sessionCookieFrom(res)
}

export function sessionCookieFrom(res: Response): string {
  const header = res.headers.get('set-cookie')
  if (!header) throw new Error('no set-cookie header')
  return header.split(';')[0]!
}
