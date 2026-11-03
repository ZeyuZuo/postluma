import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getConfig } from '../worker/lib/config'
import { isSendingEnabled } from '../worker/repo/settings'
import { addDomain, addMailboxRow, api, createUser, json, login, setSetting } from './helpers'

describe('temporary mode has no sending', () => {
  it('ignores the sending switch', async () => {
    await setSetting('sending_enabled', 'true')
    expect(await isSendingEnabled(env.DB, getConfig(env))).toBe(false)
    expect(await isSendingEnabled(env.DB, getConfig({ ...env, SERVICE_MODE: 'personal' } as Env))).toBe(true)
  })

  it('hides every sending endpoint, even with the switch on', async () => {
    await setSetting('sending_enabled', 'true')
    const domainId = await addDomain('mail.test')
    await env.DB.prepare('UPDATE domains SET can_send = 1 WHERE id = ?').bind(domainId).run()
    const adminId = await createUser('root', { role: 'admin' })
    const aliceId = await createUser('alice')
    const box = await addMailboxRow(adminId, domainId, 'root@mail.test')
    const cookie = await login('root')

    const requests: [string, string, unknown][] = [
      ['GET', '/api/outbox', undefined],
      ['POST', '/api/outbox', { mailboxId: box, to: ['friend@example.org'], subject: 'Hi', text: 'Hi', idempotencyKey: 'key-1-abcdef' }],
      ['GET', '/api/admin/sending', undefined],
      ['PATCH', '/api/admin/sending', { enabled: true }],
      ['POST', '/api/admin/sending/test', { domainId, to: 'friend@example.org' }],
      ['PATCH', `/api/admin/domains/${domainId}`, { canSend: true }],
      ['PATCH', `/api/admin/users/${aliceId}/sending`, { canSend: true, sendQuota: null }],
    ]
    for (const [method, path, body] of requests) {
      expect((await api(path, { cookie, method, body })).status, `${method} ${path}`).toBe(404)
    }
    expect(await json(await api('/api/outbox/status', { cookie }))).toMatchObject({ canSend: false })
    expect(await json(await api('/api/auth/me', { cookie }))).toMatchObject({ canSend: false })
    expect(await env.DB.prepare('SELECT COUNT(*) AS n FROM sent_messages').first('n')).toBe(0)
    expect(await env.DB.prepare('SELECT can_send FROM users WHERE id = ?').bind(aliceId).first('can_send')).toBe(0)
  })
})
