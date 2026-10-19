/** Every admin endpoint is closed to ordinary users and anonymous callers. */
import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { addDomain, addMailboxRow, addMessageRow, api, createUser, login } from '../helpers'

const ENDPOINTS: { path: string; method?: string; body?: unknown }[] = [
  { path: '/api/admin/users' },
  { path: '/api/admin/users/x/action', body: { action: 'approve' } },
  { path: '/api/admin/users/x/quota', method: 'PATCH', body: { mailboxQuota: 5 } },
  { path: '/api/admin/users/x/message-count' },
  { path: '/api/admin/users/x/purge-messages', body: {} },
  { path: '/api/admin/users/x', method: 'DELETE' },
  { path: '/api/admin/settings' },
  { path: '/api/admin/settings', method: 'PATCH', body: { registrationOpen: false } },
  { path: '/api/admin/stats' },
  { path: '/api/admin/audit' },
  { path: '/api/admin/cleanup', body: { olderThanDays: 1 } },
]

describe('admin endpoints', () => {
  it('return 403 to ordinary users and 401 to anonymous callers, and change nothing', async () => {
    await createUser('bob')
    const victim = await createUser('victim', { status: 'pending' })
    const box = await addMailboxRow(victim, await addDomain('mail.test'), 'victim@mail.test')
    await addMessageRow(box, { receivedAt: 1 })
    const cookie = await login('bob')
    for (const raw of ENDPOINTS) {
      const e = { ...raw, path: raw.path.replace('/users/x', `/users/${victim}`) }
      expect((await api(e.path, { ...e, cookie })).status, `${e.method ?? 'GET'} ${e.path}`).toBe(403)
      expect((await api(e.path, e)).status, `anon ${e.method ?? 'GET'} ${e.path}`).toBe(401)
    }
    const row = await env.DB.prepare('SELECT status, mailbox_quota FROM users WHERE id = ?').bind(victim).first()
    expect(row).toEqual({ status: 'pending', mailbox_quota: null })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM messages').first()).toEqual({ n: 1 })
    expect(await env.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'registration_open'").first()).toEqual({ n: 0 })
  })
})
