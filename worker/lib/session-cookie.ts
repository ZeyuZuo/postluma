import type { Context } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'

import type { AppEnv } from '../types'

// With prefix 'host' Hono emits "__Host-postluma_session" and enforces Secure + Path=/ + no Domain.
const COOKIE_NAME = 'postluma_session'

export function readSessionToken(c: Context<AppEnv>): string | undefined {
  return getCookie(c, COOKIE_NAME, 'host')
}

export function writeSessionCookie(c: Context<AppEnv>, token: string, expiresAt: number): void {
  setCookie(c, COOKIE_NAME, token, {
    prefix: 'host',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    expires: new Date(expiresAt),
  })
}

export function clearSessionCookie(c: Context<AppEnv>): void {
  deleteCookie(c, COOKIE_NAME, { prefix: 'host', secure: true, path: '/' })
}
