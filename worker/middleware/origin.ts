import { createMiddleware } from 'hono/factory'

import { ApiError } from '../lib/errors'
import type { AppEnv } from '../types'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** CSRF guard: state-changing requests must come from this site's own origin. */
export const checkOrigin = createMiddleware<AppEnv>(async (c, next) => {
  if (!SAFE_METHODS.has(c.req.method)) {
    if (c.req.header('origin') !== new URL(c.req.url).origin) throw new ApiError(403, 'bad_origin')
  }
  await next()
})
