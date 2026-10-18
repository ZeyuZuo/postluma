import type { Context } from 'hono'
import type { z } from 'zod'

import type { AppEnv } from '../types'
import { ApiError } from './errors'

export function clientIp(c: Context<AppEnv>): string {
  return c.req.header('cf-connecting-ip') ?? 'unknown'
}

export async function parseJson<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    throw new ApiError(400, 'invalid_input')
  }
  const result = schema.safeParse(body)
  if (!result.success) throw new ApiError(400, 'invalid_input')
  return result.data
}

export function parseQuery<S extends z.ZodType>(c: Context<AppEnv>, schema: S): z.output<S> {
  const result = schema.safeParse(c.req.query())
  if (!result.success) throw new ApiError(400, 'invalid_input')
  return result.data
}

export async function enforceRateLimit(env: Env, key: string): Promise<void> {
  const { success } = await env.AUTH_LIMITER.limit({ key })
  if (!success) throw new ApiError(429, 'rate_limited')
}
