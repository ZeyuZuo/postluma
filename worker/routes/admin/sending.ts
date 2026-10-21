import { Hono } from 'hono'

import { adminSendTestSchema, adminSendingSchema, type AdminSendingStatus } from '../../../shared/api'
import { getConfig } from '../../lib/config'
import { ApiError } from '../../lib/errors'
import { getMailer } from '../../lib/mailer'
import { clientIp, enforceRateLimit, parseJson } from '../../lib/request'
import { auditStatement, writeAudit } from '../../repo/audit'
import { getSetting, overrideStatement } from '../../repo/settings'
import type { AppEnv } from '../../types'

const DAY_MS = 24 * 60 * 60 * 1000

/** Mounted under /api/admin/sending (requireAdmin already ran): the service-wide switch and a test send. */
export const adminSendingRoutes = new Hono<AppEnv>()

async function status(env: Env): Promise<AdminSendingStatus> {
  const config = getConfig(env)
  const mailer = getMailer(env, config)
  const override = await getSetting(env.DB, 'sending_enabled')
  const used = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM (SELECT 1 FROM sent_messages WHERE created_at > ? AND counted = 1 LIMIT ?)',
  )
    .bind(Date.now() - DAY_MS, config.sending.perDay)
    .first<{ n: number }>()
  return {
    enabled: override === null ? config.sending.enabled : override === 'true',
    overridden: override !== null,
    defaultEnabled: config.sending.enabled,
    provider: mailer.name,
    configured: mailer.configured,
    perDay: config.sending.perDay,
    perUserPerDay: config.sending.perUserPerDay,
    maxRecipients: config.sending.maxRecipients,
    usedToday: used?.n ?? 0,
  }
}

adminSendingRoutes.get('/', async (c) => c.json(await status(c.env)))

adminSendingRoutes.patch('/', async (c) => {
  const { enabled } = await parseJson(c, adminSendingSchema)
  await c.env.DB.batch([
    overrideStatement(c.env.DB, 'sending_enabled', enabled === null ? null : String(enabled)),
    auditStatement(c.env.DB, { actorId: c.get('user').id, action: 'admin.sending_update', detail: { enabled }, ip: clientIp(c) }),
  ])
  return c.json(await status(c.env))
})

/**
 * Sends one fixed test message from no-reply@<domain> to an address the admin types (their own),
 * to check the provider and the domain's DNS before letting users send. Not counted in quotas.
 */
adminSendingRoutes.post('/test', async (c) => {
  const { domainId, to } = await parseJson(c, adminSendTestSchema)
  const admin = c.get('user')
  await enforceRateLimit(c.env, `send-test:${admin.id}`)
  const domain = await c.env.DB.prepare('SELECT domain FROM domains WHERE id = ? AND can_send = 1').bind(domainId).first<{ domain: string }>()
  if (!domain) throw new ApiError(404, 'not_found')
  const config = getConfig(c.env)
  const result = await getMailer(c.env, config).send({
    from: `no-reply@${domain.domain}`,
    to: [to],
    subject: 'PostLuma test message',
    text: `This is a test message from PostLuma, sent by ${admin.username} to check the sending setup for ${domain.domain}.`,
    idempotencyKey: `test:${crypto.randomUUID()}`,
  })
  await writeAudit(c.env.DB, {
    actorId: admin.id,
    action: 'admin.sending_test',
    detail: { domain: domain.domain, ok: result.ok, error: result.ok ? null : result.error },
    ip: clientIp(c),
  })
  return c.json(result.ok ? { ok: true } : { ok: false, error: result.error })
})
