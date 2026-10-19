import { env, SELF } from 'cloudflare:test'

import { app } from '../worker/app'
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
  /** Deploy-time var overrides (e.g. `{ MAX_TOTAL_MAILBOXES: '3' }`); runs the app in-process. */
  env?: Partial<Record<keyof Env, string>>
}

export function api(path: string, opts: ApiOptions = {}): Promise<Response> {
  const headers = new Headers({ 'cf-connecting-ip': opts.ip ?? uniqueIp() })
  if (opts.body !== undefined) headers.set('content-type', 'application/json')
  if (opts.origin !== null) headers.set('origin', opts.origin ?? ORIGIN)
  if (opts.cookie) headers.set('cookie', opts.cookie)
  const init: RequestInit = {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  }
  if (opts.env) return Promise.resolve(app.request(`${ORIGIN}${path}`, init, { ...env, ...opts.env } as Env))
  return SELF.fetch(`${ORIGIN}${path}`, init)
}

/** Writes an admin runtime override (what the admin panel will store). */
export async function setSetting(key: string, value: string): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, value)
    .run()
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

export async function addDomain(domain: string, enabled = true): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO domains (id, domain, enabled, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, domain, enabled ? 1 : 0, Date.now())
    .run()
  return id
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T
}

export interface EmailStub extends ForwardableEmailMessage {
  rejected: string | null
}

/** A minimal ForwardableEmailMessage around a raw MIME string, for calling the email handler. */
export function emailStub(raw: string, envelope: { from?: string; to: string; rawSize?: number }): EmailStub {
  const bytes = new TextEncoder().encode(raw.replace(/\r?\n/g, '\r\n'))
  const stub = {
    from: envelope.from ?? 'sender@example.org',
    to: envelope.to,
    raw: new Response(bytes).body!,
    rawSize: envelope.rawSize ?? bytes.byteLength,
    headers: new Headers(),
    rejected: null as string | null,
    setReject(reason: string) {
      stub.rejected = reason
    },
    forward: async () => ({}) as EmailSendResult,
    reply: async () => ({}) as EmailSendResult,
  }
  return stub as unknown as EmailStub
}

export function mime(opts: { from?: string; to?: string; subject?: string; text?: string; html?: string; headers?: string }): string {
  const head = [
    `From: ${opts.from ?? 'Example <no-reply@example.org>'}`,
    `To: ${opts.to ?? 'someone@mail.test'}`,
    `Subject: ${opts.subject ?? 'Hello'}`,
    'Message-ID: <test-1@example.org>',
    'MIME-Version: 1.0',
    ...(opts.headers ? [opts.headers] : []),
  ]
  if (opts.html !== undefined && opts.text === undefined) {
    return [...head, 'Content-Type: text/html; charset=utf-8', '', opts.html].join('\n')
  }
  return [...head, 'Content-Type: text/plain; charset=utf-8', '', opts.text ?? 'Hi there'].join('\n')
}

export async function addMailboxRow(userId: string, domainId: string, address: string, status = 'active'): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO mailboxes (id, user_id, domain_id, address, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)',
  )
    .bind(id, userId, domainId, address, status)
    .run()
  return id
}

let messageClock = Date.UTC(2026, 9, 19, 8, 0)

/** Inserts a stored message directly (bypassing ingest) with increasing timestamps. */
export async function addMessageRow(
  mailboxId: string,
  fields: Partial<{ subject: string; snippet: string; code: string; html: string; text: string; read: boolean; from: string; receivedAt: number; attachmentsJson: string }> = {},
): Promise<string> {
  const id = crypto.randomUUID()
  messageClock += 1000
  await env.DB.prepare(
    `INSERT INTO messages (id, mailbox_id, user_id, from_address, from_name, to_address, subject, snippet, text_body,
       html_body, verification_code, size, is_read, envelope_from, attachments_json, received_at)
     SELECT ?, m.id, m.user_id, ?, 'Sender', m.address, ?, ?, ?, ?, ?, 100, ?, 'bounce@mailer.example', ?, ?
     FROM mailboxes m WHERE m.id = ?`,
  )
    .bind(
      id,
      fields.from ?? 'sender@example.org',
      fields.subject ?? 'Hello',
      fields.snippet ?? 'Hi there',
      fields.text ?? 'Hi there',
      fields.html ?? null,
      fields.code ?? null,
      fields.read ? 1 : 0,
      fields.attachmentsJson ?? null,
      fields.receivedAt ?? messageClock,
      mailboxId,
    )
    .run()
  return id
}
