import { Hono } from 'hono'

import { listOutboxQuerySchema, sendMailSchema } from '../../shared/api'
import { getConfig } from '../lib/config'
import { ApiError } from '../lib/errors'
import { getMailer } from '../lib/mailer'
import { clientIp, enforceRateLimit, parseJson, parseQuery } from '../lib/request'
import { finishSend, getOutboxStatus, getSent, listSent, reserveSend } from '../repo/outbox'
import { isSendingEnabled } from '../repo/settings'
import type { AppEnv } from '../types'

/**
 * Sending from the signed-in user's own addresses (Phase 9). With the service-wide switch off,
 * everything but /status is 404, so the feature is invisible.
 */
export const outboxRoutes = new Hono<AppEnv>()

/** The answered message's Message-ID came from its sender: thread only on a plain `<id>`. */
function threadId(header: string | null): string | null {
  if (!header) return null
  const value = header.trim().startsWith('<') ? header.trim() : `<${header.trim()}>`
  return /^<[\x21-\x3b\x3d\x3f-\x7e]{1,250}>$/.test(value) ? value : null
}

outboxRoutes.get('/status', async (c) => {
  const config = getConfig(c.env)
  const enabled = await isSendingEnabled(c.env.DB, config)
  return c.json(await getOutboxStatus(c.env.DB, c.get('user').id, enabled, config.sending))
})

outboxRoutes.use('*', async (c, next) => {
  if (!(await isSendingEnabled(c.env.DB, getConfig(c.env)))) throw new ApiError(404, 'not_found')
  await next()
})

outboxRoutes.get('/', async (c) => {
  const { cursor } = parseQuery(c, listOutboxQuerySchema)
  return c.json(await listSent(c.env.DB, c.get('user').id, cursor))
})

outboxRoutes.get('/:id', async (c) => c.json({ message: await getSent(c.env.DB, c.get('user').id, c.req.param('id')) }))

outboxRoutes.post('/', async (c) => {
  const input = await parseJson(c, sendMailSchema)
  const config = getConfig(c.env)
  if (input.to.length > config.sending.maxRecipients) throw new ApiError(400, 'too_many_recipients')
  const userId = c.get('user').id
  // Quotas are the real limit; this only stops a script hammering the endpoint.
  await enforceRateLimit(c.env, `send:user:${userId}`)

  const mailer = getMailer(c.env, config)
  const reservation = await reserveSend(c.env.DB, userId, input, config.sending, mailer.name, clientIp(c))
  if (!reservation.duplicate) {
    const parent = threadId(reservation.replyToHeader)
    const thread = parent ? { 'In-Reply-To': parent, References: parent } : undefined
    const result = await mailer.send({
      from: reservation.fromAddress,
      to: input.to,
      subject: input.subject,
      text: input.text,
      headers: thread,
      idempotencyKey: `${userId}:${input.idempotencyKey}`,
    })
    await finishSend(c.env.DB, reservation.id, result.ok ? { ok: true, providerId: result.id } : result)
  }
  return c.json({ message: await getSent(c.env.DB, userId, reservation.id) }, reservation.duplicate ? 200 : 201)
})
