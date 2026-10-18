import { createMiddleware } from 'hono/factory'

import { ApiError } from '../lib/errors'
import { clearSessionCookie, readSessionToken } from '../lib/session-cookie'
import { findSessionUser } from '../repo/sessions'
import type { AppEnv } from '../types'

/**
 * Resolves the session on every request and re-checks the account status, so a ban or rejection
 * takes effect immediately even for sessions issued earlier.
 */
export const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = readSessionToken(c)
  const found = token ? await findSessionUser(c.env.DB, token) : null
  if (!found || found.user.status !== 'active') {
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
