/**
 * Fixtures for the browser tests. Accounts are registered through the API and approved with SQL
 * against the throwaway e2e database (.wrangler/e2e); mail is injected through the dev server's
 * email endpoint, exactly like Email Routing would deliver it.
 */
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'

import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test'

export const BASE = 'http://localhost:5188'
export const DOMAIN = 'e2e.test'
const DOMAIN_ID = 'e2e-domain'
const PASSWORD = 'e2e-password-123'

/** Runs SQL against the e2e database. Only test-controlled values are interpolated. */
export function sql(command: string): void {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', '.wrangler/e2e', '--command', command], {
    stdio: 'pipe',
  })
}

export function uid(prefix: string): string {
  return `${prefix}${randomBytes(4).toString('hex')}`
}

let domainReady = false

/** A fresh, approved user (or admin), signed in on `context` (so pages opened from it are logged in). */
export async function signIn(context: BrowserContext, opts: { admin?: boolean } = {}): Promise<string> {
  const username = uid('u')
  const headers = { origin: BASE }
  const register = await context.request.post('/api/auth/register', { headers, data: { username, password: PASSWORD } })
  expect(register.status(), await register.text()).toBe(201)
  sql(
    `UPDATE users SET status = 'active'${opts.admin ? ", role = 'admin'" : ''} WHERE username = '${username}';` +
      (domainReady ? '' : ` INSERT OR IGNORE INTO domains (id, domain, enabled, created_at) VALUES ('${DOMAIN_ID}', '${DOMAIN}', 1, 0);`),
  )
  domainReady = true
  const login = await context.request.post('/api/auth/login', { headers, data: { username, password: PASSWORD } })
  expect(login.status(), await login.text()).toBe(200)
  await context.addInitScript((domainId) => {
    try {
      localStorage.setItem('postluma.locale', 'zh-CN')
      localStorage.setItem('postluma.domain', domainId)
    } catch {
      // ignore
    }
  }, DOMAIN_ID)
  return username
}

export const E2E_DOMAIN_ID = DOMAIN_ID

export interface Mailbox {
  id: string
  address: string
}

export async function createMailbox(request: APIRequestContext, localPart = uid('box')): Promise<Mailbox> {
  const res = await request.post('/api/mailboxes', { headers: { origin: BASE }, data: { domainId: DOMAIN_ID, localPart } })
  expect(res.status(), await res.text()).toBe(201)
  return ((await res.json()) as { mailbox: Mailbox }).mailbox
}

/** Delivers a raw message the way Email Routing would (the handler rejects with 400). */
export async function deliver(request: APIRequestContext, to: string, raw: string): Promise<void> {
  const from = 'sender@example.org'
  const res = await request.post(`/cdn-cgi/handler/email?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    data: raw.replace(/\r?\n/g, '\r\n'),
    headers: { 'content-type': 'message/rfc822' },
  })
  expect(res.status(), await res.text()).toBe(200)
}

export function mime(opts: { to: string; subject: string; html?: string; text?: string; from?: string; extraParts?: string }): string {
  const head = [
    `From: ${opts.from ?? 'Example <sender@example.org>'}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Message-ID: <${uid('m')}@example.org>`,
    'MIME-Version: 1.0',
  ]
  if (!opts.extraParts) {
    return [...head, `Content-Type: ${opts.html ? 'text/html' : 'text/plain'}; charset=utf-8`, '', opts.html ?? opts.text ?? ''].join('\n')
  }
  return [
    ...head,
    'Content-Type: multipart/mixed; boundary="MIX"',
    '',
    '--MIX',
    `Content-Type: ${opts.html ? 'text/html' : 'text/plain'}; charset=utf-8`,
    '',
    opts.html ?? opts.text ?? '',
    opts.extraParts,
    '--MIX--',
    '',
  ].join('\n')
}

/** A base64 MIME part, wrapped at 76 columns. */
export function part(opts: { type: string; content: Buffer; filename: string; cid?: string; inline?: boolean }): string {
  const b64 = opts.content.toString('base64').replace(/.{76}/g, '$&\n')
  return [
    '--MIX',
    `Content-Type: ${opts.type}; name="${opts.filename}"`,
    'Content-Transfer-Encoding: base64',
    ...(opts.cid ? [`Content-ID: <${opts.cid}>`] : []),
    `Content-Disposition: ${opts.inline ? 'inline' : 'attachment'}; filename="${opts.filename}"`,
    '',
    b64,
  ].join('\n')
}
