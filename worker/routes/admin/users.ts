import { Hono } from 'hono'

import { adminUserActionSchema, adminUserQuotaSchema, adminUserSendingSchema, adminUsersQuerySchema } from '../../../shared/api'
import { getConfig, mailBucket } from '../../lib/config'
import { clientIp, parseJson, parseQuery } from '../../lib/request'
import {
  applyUserAction,
  countUserMessages,
  deleteUser,
  listUsers,
  purgeUserMessages,
  setUserQuota,
  setUserSending,
} from '../../repo/admin-users'
import { auditStatement, writeAudit } from '../../repo/audit'
import type { AppEnv } from '../../types'

/** Mounted under /api/admin/users (requireAdmin already ran). */
export const adminUserRoutes = new Hono<AppEnv>()

adminUserRoutes.get('/', async (c) => c.json(await listUsers(c.env.DB, parseQuery(c, adminUsersQuerySchema))))

adminUserRoutes.post('/:id/action', async (c) => {
  const { action } = await parseJson(c, adminUserActionSchema)
  const id = c.req.param('id')
  const audit = auditStatement(c.env.DB, { actorId: c.get('user').id, action: `admin.user_${action}`, targetId: id, ip: clientIp(c) })
  return c.json({ status: await applyUserAction(c.env.DB, id, action, audit) })
})

adminUserRoutes.patch('/:id/quota', async (c) => {
  const { mailboxQuota } = await parseJson(c, adminUserQuotaSchema)
  const id = c.req.param('id')
  const audit = auditStatement(c.env.DB, { actorId: c.get('user').id, action: 'admin.user_quota', targetId: id, detail: { mailboxQuota }, ip: clientIp(c) })
  await setUserQuota(c.env.DB, id, mailboxQuota, audit)
  return c.body(null, 204)
})

adminUserRoutes.patch('/:id/sending', async (c) => {
  const sending = await parseJson(c, adminUserSendingSchema)
  const id = c.req.param('id')
  const audit = auditStatement(c.env.DB, { actorId: c.get('user').id, action: 'admin.user_sending', targetId: id, detail: sending, ip: clientIp(c) })
  await setUserSending(c.env.DB, id, sending, audit)
  return c.body(null, 204)
})

adminUserRoutes.get('/:id/message-count', async (c) => c.json({ count: await countUserMessages(c.env.DB, c.req.param('id')) }))

adminUserRoutes.post('/:id/purge-messages', async (c) => {
  const id = c.req.param('id')
  const result = await purgeUserMessages(c.env.DB, mailBucket(c.env), id, getConfig(c.env).maxDeletesPerDay)
  if (result.deleted > 0) {
    await writeAudit(c.env.DB, { actorId: c.get('user').id, action: 'admin.user_purge_messages', targetId: id, detail: { deleted: result.deleted }, ip: clientIp(c) })
  }
  return c.json(result)
})

adminUserRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await deleteUser(c.env.DB, id, (username) =>
    auditStatement(c.env.DB, { actorId: c.get('user').id, action: 'admin.user_delete', targetId: id, detail: { username }, ip: clientIp(c) }),
  )
  return c.body(null, 204)
})
