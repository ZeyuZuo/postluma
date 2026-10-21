import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'

import type { PublicSettings } from '../shared/api'
import { ApiError } from './lib/errors'
import { requireAdmin, requireUser } from './middleware/auth'
import { checkOrigin } from './middleware/origin'
import { getConfig } from './lib/config'
import { isRegistrationOpen } from './repo/settings'
import { adminDomainRoutes } from './routes/admin/domains'
import { adminSystemRoutes } from './routes/admin/system'
import { adminUserRoutes } from './routes/admin/users'
import { authRoutes } from './routes/auth'
import { domainRoutes } from './routes/domains'
import { mailboxRoutes } from './routes/mailboxes'
import { messageRoutes } from './routes/messages'
import { outboxRoutes } from './routes/outbox'
import type { AppEnv } from './types'

export type { AppEnv } from './types'

/**
 * Default-deny: every /api route requires an active session unless listed here.
 * Adding a public endpoint means adding it to this set explicitly.
 */
const PUBLIC_ROUTES = new Set([
  'GET /api/health',
  'GET /api/settings/public',
  'POST /api/auth/register',
  'POST /api/auth/login',
  'POST /api/auth/logout',
])

export const app = new Hono<AppEnv>().basePath('/api')

app.use(secureHeaders())
app.use(async (c, next) => {
  await next()
  c.header('Cache-Control', 'no-store')
})
app.use(checkOrigin)
app.use(bodyLimit({ maxSize: 64 * 1024, onError: () => { throw new ApiError(413, 'payload_too_large') } }))
app.use((c, next) => {
  // Hono answers HEAD with the GET handler, so treat it as GET for the public check.
  const method = c.req.method === 'HEAD' ? 'GET' : c.req.method
  return PUBLIC_ROUTES.has(`${method} ${c.req.path}`) ? next() : requireUser(c, next)
})
app.use('/admin/*', requireAdmin)

app.get('/health', async (c) => {
  const row = await c.env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>()
  return c.json({ status: 'ok', db: row?.ok === 1 })
})

app.get('/settings/public', async (c) => {
  const settings: PublicSettings = {
    registrationOpen: await isRegistrationOpen(c.env.DB, getConfig(c.env)),
  }
  return c.json(settings)
})

app.route('/auth', authRoutes)
app.route('/domains', domainRoutes)
app.route('/mailboxes', mailboxRoutes)
app.route('/messages', messageRoutes)
app.route('/outbox', outboxRoutes)
app.route('/admin/domains', adminDomainRoutes)
app.route('/admin/users', adminUserRoutes)
app.route('/admin', adminSystemRoutes)

app.notFound((c) => c.json({ error: 'not_found' }, 404))

app.onError((err, c) => {
  if (err instanceof ApiError) return c.json({ error: err.code }, err.status)
  console.error(err)
  return c.json({ error: 'internal_error' }, 500)
})
