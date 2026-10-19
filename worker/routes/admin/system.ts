import { Hono } from 'hono'

import { adminCleanupSchema, adminSettingsSchema, auditQuerySchema } from '../../../shared/api'
import { deleteOlderThan } from '../../jobs/cleanup'
import { getConfig } from '../../lib/config'
import { ApiError } from '../../lib/errors'
import { clientIp, parseJson, parseQuery } from '../../lib/request'
import { auditStatement, listAudit, writeAudit } from '../../repo/audit'
import { getAdminSettings, overrideStatement } from '../../repo/settings'
import { getStats } from '../../repo/stats'
import type { AppEnv } from '../../types'

/** Mounted under /api/admin (requireAdmin already ran): settings, stats, audit log, maintenance. */
export const adminSystemRoutes = new Hono<AppEnv>()

adminSystemRoutes.get('/settings', async (c) => c.json(await getAdminSettings(c.env.DB, getConfig(c.env))))

adminSystemRoutes.patch('/settings', async (c) => {
  const input = await parseJson(c, adminSettingsSchema)
  const config = getConfig(c.env)
  // INGEST_MAX_MB_PER_DAY × retention must fit the database, or it fills up and every write fails.
  if (typeof input.retentionDays === 'number' && input.retentionDays > config.maxRetentionDays) {
    throw new ApiError(400, 'retention_too_long')
  }
  const str = (v: boolean | number | null) => (v === null ? null : String(v))
  const writes = [
    ...(input.registrationOpen !== undefined ? [overrideStatement(c.env.DB, 'registration_open', str(input.registrationOpen))] : []),
    ...(input.defaultMailboxQuota !== undefined ? [overrideStatement(c.env.DB, 'default_mailbox_quota', str(input.defaultMailboxQuota))] : []),
    ...(input.retentionDays !== undefined ? [overrideStatement(c.env.DB, 'retention_days', str(input.retentionDays))] : []),
  ]
  // All-or-nothing, including the audit row.
  await c.env.DB.batch([
    ...writes,
    auditStatement(c.env.DB, { actorId: c.get('user').id, action: 'admin.settings_update', detail: input, ip: clientIp(c) }),
  ])
  return c.json(await getAdminSettings(c.env.DB, config))
})

adminSystemRoutes.get('/stats', async (c) => c.json(await getStats(c.env.DB, getConfig(c.env))))

adminSystemRoutes.get('/audit', async (c) => c.json(await listAudit(c.env.DB, parseQuery(c, auditQuerySchema).cursor)))

adminSystemRoutes.post('/cleanup', async (c) => {
  const { olderThanDays } = await parseJson(c, adminCleanupSchema)
  const result = await deleteOlderThan(c.env, olderThanDays)
  if (result.deleted > 0) {
    await writeAudit(c.env.DB, { actorId: c.get('user').id, action: 'admin.cleanup', detail: { olderThanDays, deleted: result.deleted }, ip: clientIp(c) })
  }
  return c.json(result)
})
