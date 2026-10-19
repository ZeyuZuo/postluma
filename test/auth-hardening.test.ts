/** Regression tests for the auth security review findings. */
import { env } from 'cloudflare:test'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PBKDF2_ITERATIONS, verifyPassword } from '../worker/lib/password'
import { requireTurnstile } from '../worker/lib/turnstile'
import { prepareSession } from '../worker/repo/sessions'
import { DEFAULT_PASSWORD, api, createUser, login, sessionCookieFrom } from './helpers'

const sessionCount = async (userId: string) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').bind(userId).first<{ n: number }>())?.n

describe('login lockout resistance', () => {
  it('failed attempts from other clients cannot lock a user out', async () => {
    await createUser('bob')
    for (let i = 0; i < 15; i++) {
      await api('/api/auth/login', { body: { username: 'bob', password: 'wrong-password' } })
    }
    expect((await api('/api/auth/login', { body: { username: 'bob', password: DEFAULT_PASSWORD } })).status).toBe(200)
  })
})

describe('route gate edge cases', () => {
  it('serves HEAD on public routes and keeps path variants closed', async () => {
    expect((await api('/api/health', { method: 'HEAD' })).status).toBe(200)
    expect((await api('/api/health/')).status).toBe(401)
    expect((await api('/api/settings/public/')).status).toBe(401)
  })

  it('guards /api/admin without a trailing segment', async () => {
    await createUser('mallory')
    expect((await api('/api/admin', { cookie: await login('mallory') })).status).toBe(403)
  })

  it('applies the Origin check to every state-changing auth endpoint', async () => {
    await createUser('oscar')
    const cookie = await login('oscar')
    const calls = [
      { path: '/api/auth/me', method: 'PATCH', body: { locale: 'en' } },
      { path: '/api/auth/password', method: 'POST', body: { currentPassword: DEFAULT_PASSWORD, newPassword: 'x'.repeat(12) } },
      { path: '/api/auth/logout', method: 'POST', body: {} },
    ]
    for (const call of calls) {
      const res = await api(call.path, { ...call, cookie, origin: 'https://evil.example' })
      expect(res.status, call.path).toBe(403)
    }
    expect((await api('/api/auth/me', { cookie })).status).toBe(200)
  })

  it('rejects oversized request bodies', async () => {
    const res = await api('/api/auth/login', { body: { username: 'x', password: 'y', pad: 'z'.repeat(100_000) } })
    expect(res.status).toBe(413)
  })
})

describe('session lifecycle', () => {
  it('rotates the token when logging in again with an existing cookie', async () => {
    const id = await createUser('peggy')
    const first = await login('peggy')
    const res = await api('/api/auth/login', { cookie: first, body: { username: 'peggy', password: DEFAULT_PASSWORD } })
    expect(res.status).toBe(200)
    expect((await api('/api/auth/me', { cookie: first })).status).toBe(401)
    expect((await api('/api/auth/me', { cookie: sessionCookieFrom(res) })).status).toBe(200)
    expect(await sessionCount(id)).toBe(1)
  })

  it('rejects expired sessions', async () => {
    const id = await createUser('quinn')
    const cookie = await login('quinn')
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE user_id = ?').bind(Date.now() - 1, id).run()
    expect((await api('/api/auth/me', { cookie })).status).toBe(401)
  })

  it('creates no session for non-active accounts even with the right password', async () => {
    for (const status of ['pending', 'rejected', 'banned'] as const) {
      const id = await createUser(`rita-${status}`, { status })
      const res = await api('/api/auth/login', { body: { username: `rita-${status}`, password: DEFAULT_PASSWORD } })
      expect(res.status, status).toBe(403)
      expect(res.headers.get('set-cookie')).toBeNull()
      expect(await sessionCount(id)).toBe(0)
    }
  })

  it('a wrong current password changes nothing and is audited', async () => {
    const id = await createUser('sam')
    const cookie = await login('sam')
    const before = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(id).first()
    const res = await api('/api/auth/password', {
      cookie,
      body: { currentPassword: 'not-my-password', newPassword: 'another-password' },
    })
    expect(res.status).toBe(400)
    expect(await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(id).first()).toEqual(before)
    expect((await api('/api/auth/me', { cookie })).status).toBe(200)
    const audit = await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'auth.password_change_failed'").first<{ n: number }>()
    expect(audit?.n).toBe(1)
  })

  it('a session prepared before a password change is never inserted', async () => {
    const id = await createUser('trent')
    const user = await env.DB.prepare('SELECT password_hash FROM users WHERE id = ?').bind(id).first<{ password_hash: string }>()
    const pending = await prepareSession(env.DB, { id, passwordHash: user!.password_hash }, { ip: 'x', userAgent: undefined })
    await env.DB.prepare("UPDATE users SET password_hash = 'changed' WHERE id = ?").bind(id).run()
    expect((await pending.statement.run()).meta.changes).toBe(0)
    expect(await sessionCount(id)).toBe(0)
  })
})

describe('initial admin bootstrap', () => {
  it('never re-runs after the admin account is gone', async () => {
    await login('admin', 'test-admin-password')
    await env.DB.prepare("DELETE FROM users WHERE username = 'admin'").run()
    const res = await api('/api/auth/login', { body: { username: 'admin', password: 'test-admin-password' } })
    expect(res.status).toBe(401)
    const admins = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>()
    expect(admins?.n).toBe(0)
  })

  it('reserved names cannot be registered in any spelling', async () => {
    for (const username of [' admin ', 'Admin', 'administrator', 'ROOT']) {
      const res = await api('/api/auth/register', { body: { username, password: DEFAULT_PASSWORD } })
      expect(res.status, username).toBe(409)
    }
  })
})

describe('password hash parsing', () => {
  it('treats corrupt or weak stored hashes as non-matching instead of throwing', async () => {
    expect(await verifyPassword('pw', `pbkdf2-sha256$${PBKDF2_ITERATIONS}$!!!not-base64$AAAA`)).toBe(false)
    expect(await verifyPassword('pw', 'pbkdf2-sha256$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA')).toBe(false)
  })
})

describe('Turnstile verification', () => {
  const expected = { hostname: 'postluma.test', action: 'login' }
  const enabledEnv = { ...env, TURNSTILE_SECRET_KEY: 'secret', TURNSTILE_DISABLED: '' } as Env
  const reply = (body: unknown, status = 200) =>
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }))

  afterEach(() => vi.restoreAllMocks())

  it('fails closed when the secret is missing and bypass is not set', async () => {
    const misconfigured = { ...env, TURNSTILE_SECRET_KEY: '', TURNSTILE_DISABLED: '' } as Env
    await expect(requireTurnstile(misconfigured, 'tok', '1.2.3.4', expected)).rejects.toMatchObject({ status: 500 })
  })

  it('requires a token', async () => {
    await expect(requireTurnstile(enabledEnv, undefined, '1.2.3.4', expected)).rejects.toMatchObject({
      code: 'turnstile_failed',
    })
  })

  it('accepts only a successful result for this hostname and action', async () => {
    reply({ success: true, hostname: 'postluma.test', action: 'login' })
    await expect(requireTurnstile(enabledEnv, 'tok', '1.2.3.4', expected)).resolves.toBeUndefined()

    for (const body of [
      { success: false, hostname: 'postluma.test', action: 'login' },
      { success: true, hostname: 'evil.example', action: 'login' },
      { success: true, hostname: 'postluma.test', action: 'register' },
    ]) {
      reply(body)
      await expect(requireTurnstile(enabledEnv, 'tok', '1.2.3.4', expected)).rejects.toMatchObject({
        code: 'turnstile_failed',
      })
    }
  })

  it('maps siteverify outages to turnstile_failed instead of a 500', async () => {
    reply({ error: 'down' }, 503)
    await expect(requireTurnstile(enabledEnv, 'tok', '1.2.3.4', expected)).rejects.toMatchObject({
      code: 'turnstile_failed',
    })
  })
})
