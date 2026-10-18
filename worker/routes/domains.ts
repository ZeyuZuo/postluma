import { Hono } from 'hono'

import { listEnabledDomains } from '../repo/domains'
import type { AppEnv } from '../types'

/** Domains a signed-in user may create mailboxes on. */
export const domainRoutes = new Hono<AppEnv>()

domainRoutes.get('/', async (c) => c.json({ items: await listEnabledDomains(c.env.DB) }))
