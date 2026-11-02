/**
 * Fixtures for the browser tests. In temporary mode accounts are registered through the API and
 * approved with SQL against the project's throwaway database; personal mode has no sign-up, so they
 * are inserted directly. Mail is injected through the dev server's email endpoint, exactly like
 * Email Routing would deliver it.
 */
import { execFileSync } from 'node:child_process'
import { pbkdf2Sync, randomBytes } from 'node:crypto'

import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test'

export const DOMAIN = 'e2e.test'
const DOMAIN_ID = 'e2e-domain'
export const PASSWORD = 'e2e-password-123'

/** Each Playwright project has its own dev server and database. Keep in step with playwright.config.ts. */
const PROJECTS = {
  temporary: { port: 5188, state: '.wrangler/e2e' },
  personal: { port: 5189, state: '.wrangler/e2e-personal' },
} as const
type ProjectName = keyof typeof PROJECTS

function project() {
  const name = test.info().project.name as ProjectName
  return { name, ...PROJECTS[name] }
}

/** The running project's dev server, also the Origin that state-changing requests need. */
export function base(): string {
  return `http://localhost:${project().port}`
}

/** Runs SQL against the project's e2e database. Only test-controlled values are interpolated. */
export function sql(command: string): void {
  execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--persist-to', project().state, '--command', command], {
    stdio: 'pipe',
  })
}

export function uid(prefix: string): string {
  return `${prefix}${randomBytes(4).toString('hex')}`
}

const domainReady = new Set<ProjectName>()

/** Adds the e2e domain on first use in this project, appended to another statement to save a wrangler run. */
function domainSql(): string {
  const { name } = project()
  if (domainReady.has(name)) return ''
  domainReady.add(name)
  return ` INSERT OR IGNORE INTO domains (id, domain, enabled, created_at) VALUES ('${DOMAIN_ID}', '${DOMAIN}', 1, 0);`
}

/** PASSWORD in the stored format of worker/lib/password.ts (PBKDF2-SHA256, 16-byte salt, 256-bit key). */
function passwordHash(): string {
  const iterations = 20_000
  const salt = randomBytes(16)
  const hash = pbkdf2Sync(PASSWORD, salt, iterations, 32, 'sha256')
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`
}

/** An active account inserted straight into the database (personal mode has no sign-up). */
export async function createAccount(opts: { admin?: boolean } = {}): Promise<string> {
  const username = uid('u')
  const hash = passwordHash()
  const now = Date.now()
  sql(
    `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
     VALUES ('${uid('id')}', '${username}', '${hash}', '${opts.admin ? 'admin' : 'user'}', 'active', ${now}, ${now});` + domainSql(),
  )
  return username
}

/** A fresh, approved user (or admin), signed in on `context` (so pages opened from it are logged in). */
export async function signIn(context: BrowserContext, opts: { admin?: boolean } = {}): Promise<string> {
  const headers = { origin: base() }
  let username: string
  if (project().name === 'personal') {
    username = await createAccount(opts)
  } else {
    username = uid('u')
    const register = await context.request.post('/api/auth/register', { headers, data: { username, password: PASSWORD } })
    expect(register.status(), await register.text()).toBe(201)
    sql(`UPDATE users SET status = 'active'${opts.admin ? ", role = 'admin'" : ''} WHERE username = '${username}';` + domainSql())
  }
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
  const res = await request.post('/api/mailboxes', { headers: { origin: base() }, data: { domainId: DOMAIN_ID, localPart } })
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
