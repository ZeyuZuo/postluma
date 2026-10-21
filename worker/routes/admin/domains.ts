import { Hono } from 'hono'

import { createDomainSchema, updateDomainSchema } from '../../../shared/api'
import { checkDomainMx } from '../../lib/dns-health'
import { clientIp, parseJson } from '../../lib/request'
import { writeAudit } from '../../repo/audit'
import { createDomain, deleteUnusedDomain, findDomainName, listAllDomains, setDomainEnabled } from '../../repo/domains'
import type { AppEnv } from '../../types'

/** Mounted under /api/admin, so `requireAdmin` has already run. */
export const adminDomainRoutes = new Hono<AppEnv>()

adminDomainRoutes.get('/', async (c) => c.json({ items: await listAllDomains(c.env.DB) }))

/** Read-only DNS lookup (no audit row): is the MX pointing at Cloudflare Email Routing? */
adminDomainRoutes.get('/:id/health', async (c) => {
  const domain = await findDomainName(c.env.DB, c.req.param('id'))
  return c.json({ health: await checkDomainMx(domain) })
})

adminDomainRoutes.post('/', async (c) => {
  const { domain } = await parseJson(c, createDomainSchema)
  const id = await createDomain(c.env.DB, domain)
  await writeAudit(c.env.DB, {
    actorId: c.get('user').id,
    action: 'admin.domain_create',
    targetId: id,
    detail: { domain },
    ip: clientIp(c),
  })
  return c.json({ id }, 201)
})

adminDomainRoutes.patch('/:id', async (c) => {
  const { enabled } = await parseJson(c, updateDomainSchema)
  const id = c.req.param('id')
  const domain = await setDomainEnabled(c.env.DB, id, enabled)
  await writeAudit(c.env.DB, {
    actorId: c.get('user').id,
    action: 'admin.domain_update',
    targetId: id,
    detail: { domain, enabled },
    ip: clientIp(c),
  })
  return c.body(null, 204)
})

adminDomainRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const domain = await deleteUnusedDomain(c.env.DB, id)
  await writeAudit(c.env.DB, {
    actorId: c.get('user').id,
    action: 'admin.domain_delete',
    targetId: id,
    detail: { domain },
    ip: clientIp(c),
  })
  return c.body(null, 204)
})
