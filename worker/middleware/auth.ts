import { createMiddleware } from 'hono/factory'

import { getConfig } from '../lib/config'
import { ApiError } from '../lib/errors'
import { clearSessionCookie, readSessionToken } from '../lib/session-cookie'
import { findSessionUser } from '../repo/sessions'
import type { AppEnv } from '../types'

/**
 * Resolves the session on every request and re-checks the account status, so a ban or rejection
 * takes effect immediately even for sessions issued earlier. In personal mode only administrators
 * count as signed in, so switching a deployment to it ends every other session at once.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionToken(c)
  const found = token ? await findSessionUser(c.env.DB, token) : null
  const allowed = found?.user.status === 'active' && (getConfig(c.env).mode !== 'personal' || found.user.role === 'admin')
  if (!found || !allowed) {
    if (token) clearSessionCookie(c)
    throw new ApiError(401, 'unauthorized')
  }
  c.set('user', found.user)
  c.set('sessionId', found.sessionId)
  await next()
})

/** Must run after `requireUser`. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (c.get('user').role !== 'admin') throw new ApiError(403, 'forbidden')
  await next()
})
