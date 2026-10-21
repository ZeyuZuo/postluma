import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

import { getConfig } from '../worker/lib/config'
import { isSendingEnabled } from '../worker/repo/settings'
import { addDomain, createUser } from './helpers'

describe('sending configuration (Phase 9.1)', () => {
  it('is off everywhere by default', async () => {
    const config = getConfig({ ...env, SENDING_ENABLED: undefined, MAIL_PROVIDER: undefined } as unknown as Env)
    expect(config.sending).toEqual({ enabled: false, provider: 'resend', perUserPerDay: 20, perDay: 100, maxRecipients: 5 })
    expect(await isSendingEnabled(env.DB, getConfig(env))).toBe(false)

    const domainId = await addDomain('mail.test')
    const userId = await createUser('alice')
    expect(await env.DB.prepare('SELECT can_send FROM domains WHERE id = ?').bind(domainId).first('can_send')).toBe(0)
    const user = await env.DB.prepare('SELECT can_send, send_quota FROM users WHERE id = ?').bind(userId).first()
    expect(user).toEqual({ can_send: 0, send_quota: null })
  })

  it('lets the admin setting override the deploy default', async () => {
    const config = getConfig(env)
    await env.DB.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('sending_enabled', 'true', 0)").run()
    expect(await isSendingEnabled(env.DB, config)).toBe(true)
    await env.DB.prepare("UPDATE settings SET value = 'false' WHERE key = 'sending_enabled'").run()
    expect(await isSendingEnabled(env.DB, { ...config, sending: { ...config.sending, enabled: true } })).toBe(false)
  })

  it('validates the provider and the limits', () => {
    const config = getConfig({ ...env, MAIL_PROVIDER: 'smtp', SEND_MAX_RECIPIENTS: '500', SEND_MAX_PER_DAY: '0' } as unknown as Env)
    expect(config.sending.provider).toBe('resend')
    expect(config.sending.maxRecipients).toBe(5)
    expect(config.sending.perDay).toBe(0)
  })
})
