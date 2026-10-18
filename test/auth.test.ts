import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { DEFAULT_PASSWORD, api, createUser, login, sessionCookieFrom, uniqueIp } from './helpers'

async function setStatus(userId: string, status: string): Promise<void> {
  await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(status, userId).run()
}

describe('registration', () => {
  it('creates a pending account that cannot log in until approved', async () => {
    const res = await api('/api/auth/register', { body: { username: 'alice', password: DEFAULT_PASSWORD } })
    expect(res.status).toBe(201)
    const row = await env.DB.prepare("SELECT status, role, password_hash FROM users WHERE username = 'alice'").first<{
      status: string
      role: string
      password_hash: string
    }>()
    expect(row).toMatchObject({ status: 'pending', role: 'user' })
    expect(row?.password_hash).not.toContain(DEFAULT_PASSWORD)

    const loginRes = await api('/api/auth/login', { body: { username: 'alice', password: DEFAULT_PASSWORD } })
    expect(loginRes.status).toBe(403)
    expect(await loginRes.json()).toEqual({ error: 'account_pending' })
  })

  it('rejects reserved and duplicate usernames (case-insensitive)', async () => {
    await createUser('bob')
    for (const username of ['admin', 'ADMIN', 'BOB']) {
      const res = await api('/api/auth/register', { body: { username, password: DEFAULT_PASSWORD } })
      expect(res.status, username).toBe(409)
    }
  })

  it('validates input', async () => {
    const res = await api('/api/auth/register', { body: { username: 'a b', password: 'short' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_input' })
  })

  it('is blocked when the registration switch is off', async () => {
    await env.DB.prepare("UPDATE settings SET value = 'false' WHERE key = 'registration_open'").run()
    const res = await api('/api/auth/register', { body: { username: 'carol', password: DEFAULT_PASSWORD } })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'registration_closed' })
  })
})

describe('login and sessions', () => {
  it('issues a hardened cookie and stores only a hash of the token', async () => {
    await createUser('dave')
    const res = await api('/api/auth/login', { body: { username: 'dave', password: DEFAULT_PASSWORD } })
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toMatch(/^__Host-postluma_session=/)
    expect(setCookie).toMatch(/HttpOnly/i)
    expect(setCookie).toMatch(/Secure/i)
    expect(setCookie).toMatch(/SameSite=Lax/i)

    const token = sessionCookieFrom(res).split('=')[1]!
    const stored = await env.DB.prepare('SELECT id FROM sessions').all<{ id: string }>()
    expect(stored.results).toHaveLength(1)
    expect(stored.results[0]!.id).not.toBe(token)

    const me = await api('/api/auth/me', { cookie: sessionCookieFrom(res) })
    expect(await me.json()).toMatchObject({ user: { username: 'dave', role: 'user', status: 'active' } })
  })

  it('returns the same error for unknown users and wrong passwords', async () => {
    await createUser('erin')
    const wrong = await api('/api/auth/login', { body: { username: 'erin', password: 'nope-nope-nope' } })
    const unknown = await api('/api/auth/login', { body: { username: 'nobody', password: 'nope-nope-nope' } })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(await wrong.json()).toEqual(await unknown.json())
  })

  it('cuts off existing sessions as soon as the account is banned or rejected', async () => {
    for (const status of ['banned', 'rejected', 'pending']) {
      const id = await createUser(`frank-${status}`)
      const cookie = await login(`frank-${status}`)
      expect((await api('/api/auth/me', { cookie })).status).toBe(200)
      await setStatus(id, status)
      expect((await api('/api/auth/me', { cookie })).status, status).toBe(401)
    }
  })

  it('logout invalidates the session server-side', async () => {
    await createUser('grace')
    const cookie = await login('grace')
    expect((await api('/api/auth/logout', { method: 'POST', cookie })).status).toBe(204)
    expect((await api('/api/auth/me', { cookie })).status).toBe(401)
  })

  it('changing the password signs out every other session', async () => {
    await createUser('heidi')
    const laptop = await login('heidi')
    const phone = await login('heidi')
    const res = await api('/api/auth/password', {
      cookie: laptop,
      body: { currentPassword: DEFAULT_PASSWORD, newPassword: 'a-brand-new-password' },
    })
    expect(res.status).toBe(204)
    const fresh = sessionCookieFrom(res)
    expect((await api('/api/auth/me', { cookie: phone })).status).toBe(401)
    expect((await api('/api/auth/me', { cookie: laptop })).status).toBe(401)
    expect((await api('/api/auth/me', { cookie: fresh })).status).toBe(200)
    expect((await api('/api/auth/login', { body: { username: 'heidi', password: DEFAULT_PASSWORD } })).status).toBe(401)
  })

  it('rate-limits repeated login attempts from one IP', async () => {
    const ip = uniqueIp()
    const statuses: number[] = []
    for (let i = 0; i < 12; i++) {
      const res = await api('/api/auth/login', { ip, body: { username: `ghost${i}`, password: 'whatever-pass' } })
      statuses.push(res.status)
    }
    expect(statuses).toContain(429)
  })
})

describe('request guards', () => {
  it('denies every non-public route without a session', async () => {
    for (const path of ['/api/auth/me', '/api/mailboxes', '/api/admin/users', '/api/does-not-exist']) {
      const res = await api(path)
      expect(res.status, path).toBe(401)
    }
  })

  it('rejects state-changing requests from other origins', async () => {
    await createUser('ivan')
    for (const origin of [null, 'https://evil.example']) {
      const res = await api('/api/auth/login', { origin, body: { username: 'ivan', password: DEFAULT_PASSWORD } })
      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'bad_origin' })
    }
  })

  it('keeps /api/admin for admins only', async () => {
    await createUser('judy')
    const userCookie = await login('judy')
    expect((await api('/api/admin/users', { cookie: userCookie })).status).toBe(403)

    const adminCookie = await login('admin', 'test-admin-password')
    // Admin passes the guard; the route itself does not exist yet.
    expect((await api('/api/admin/users', { cookie: adminCookie })).status).toBe(404)
  })
})

describe('initial admin', () => {
  it('is created once from ADMIN_INITIAL_PASSWORD on first admin login', async () => {
    const cookie = await login('admin', 'test-admin-password')
    const me = await api('/api/auth/me', { cookie })
    expect(await me.json()).toMatchObject({ user: { username: 'admin', role: 'admin', status: 'active' } })
    await login('admin', 'test-admin-password')
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").first<{ n: number }>()
    expect(count?.n).toBe(1)
  })
})
