import { Hono, type Context } from 'hono'

import { changePasswordSchema, loginSchema, registerSchema, updateProfileSchema } from '../../shared/api'
import { INITIAL_ADMIN_USERNAME, ensureInitialAdmin } from '../bootstrap'
import { getConfig } from '../lib/config'
import { ApiError } from '../lib/errors'
import { burnPasswordCheck, hashPassword, verifyPassword } from '../lib/password'
import { clientIp, enforceRateLimit, parseJson } from '../lib/request'
import { clearSessionCookie, readSessionToken, writeSessionCookie } from '../lib/session-cookie'
import { requireTurnstile } from '../lib/turnstile'
import { writeAudit } from '../repo/audit'
import { deleteSessionByToken, deleteUserSessionsStatement, prepareSession } from '../repo/sessions'
import { isRegistrationOpen, isSendingEnabled } from '../repo/settings'
import {
  findUserByUsername,
  insertUser,
  isUniqueViolation,
  toPublicUser,
  touchLastLogin,
  updateLocale,
  updatePasswordHashStatement,
} from '../repo/users'
import type { AppEnv } from '../types'

const RESERVED_USERNAMES = new Set([INITIAL_ADMIN_USERNAME, 'administrator', 'root', 'system', 'postmaster'])

const STATUS_ERRORS = {
  pending: 'account_pending',
  rejected: 'account_rejected',
  banned: 'account_banned',
} as const

function turnstileExpectation(c: Context<AppEnv>, action: string) {
  return { hostname: new URL(c.req.url).hostname, action }
}

export const authRoutes = new Hono<AppEnv>()

authRoutes.post('/register', async (c) => {
  const input = await parseJson(c, registerSchema)
  const ip = clientIp(c)
  await enforceRateLimit(c.env, `register:ip:${ip}`)
  await requireTurnstile(c.env, input.turnstileToken, ip, turnstileExpectation(c, 'register'))
  const config = getConfig(c.env)
  if (!(await isRegistrationOpen(c.env.DB, config))) throw new ApiError(403, 'registration_closed')
  if (RESERVED_USERNAMES.has(input.username.toLowerCase())) throw new ApiError(409, 'username_taken')

  let userId: string
  try {
    userId = await insertUser(c.env.DB, {
      username: input.username,
      passwordHash: await hashPassword(input.password, config.passwordIterations),
      role: 'user',
      status: 'pending',
    })
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'username_taken')
    throw err
  }
  await writeAudit(c.env.DB, { actorId: userId, action: 'user.register', targetId: userId, ip })
  return c.json({ status: 'pending' as const }, 201)
})

authRoutes.post('/login', async (c) => {
  const input = await parseJson(c, loginSchema)
  const config = getConfig(c.env)
  const ip = clientIp(c)
  // Only per-IP limiting: a per-username bucket would let anyone lock a victim (or admin) out.
  // Distributed guessing is held back by Turnstile plus the PBKDF2 cost per attempt.
  await enforceRateLimit(c.env, `login:ip:${ip}`)
  await requireTurnstile(c.env, input.turnstileToken, ip, turnstileExpectation(c, 'login'))
  if (input.username.toLowerCase() === INITIAL_ADMIN_USERNAME) await ensureInitialAdmin(c.env)

  const user = await findUserByUsername(c.env.DB, input.username)
  let passwordOk = false
  if (user) passwordOk = await verifyPassword(input.password, user.password_hash)
  else await burnPasswordCheck(input.password, config.passwordIterations)

  if (!user || !passwordOk) {
    // Audit only attempts on real accounts, and never the typed text: people paste passwords or
    // addresses into the username field, and unknown names would let anyone write audit rows.
    if (user) await writeAudit(c.env.DB, { actorId: null, action: 'auth.login_failed', targetId: user.id, ip })
    throw new ApiError(401, 'invalid_credentials')
  }
  // Status is only revealed to someone who already proved the password.
  if (user.status !== 'active') throw new ApiError(403, STATUS_ERRORS[user.status])

  const previous = readSessionToken(c)
  if (previous) await deleteSessionByToken(c.env.DB, previous)
  const session = await prepareSession(
    c.env.DB,
    { id: user.id, passwordHash: user.password_hash },
    { ip, userAgent: c.req.header('user-agent') },
    config.sessionTtlMs,
  )
  // Zero rows means the password or status changed after we checked it; treat as a failed login.
  if (!(await session.statement.run()).meta.changes) throw new ApiError(401, 'invalid_credentials')
  await touchLastLogin(c.env.DB, user.id)
  writeSessionCookie(c, session.token, session.expiresAt)
  return c.json({ user: toPublicUser(user) })
})

authRoutes.post('/logout', async (c) => {
  const token = readSessionToken(c)
  if (token) await deleteSessionByToken(c.env.DB, token)
  clearSessionCookie(c)
  return c.body(null, 204)
})

/** `canSend` decides whether the client shows any sending control (the server enforces it anyway). */
authRoutes.get('/me', async (c) => {
  const user = c.get('user')
  const canSend = (user.can_send === 1 || user.role === 'admin') && (await isSendingEnabled(c.env.DB, getConfig(c.env)))
  return c.json({ user: toPublicUser(user), canSend })
})

authRoutes.patch('/me', async (c) => {
  const input = await parseJson(c, updateProfileSchema)
  const user = c.get('user')
  await updateLocale(c.env.DB, user.id, input.locale)
  return c.json({ user: toPublicUser({ ...user, locale: input.locale }) })
})

authRoutes.post('/password', async (c) => {
  const input = await parseJson(c, changePasswordSchema)
  const user = c.get('user')
  const ip = clientIp(c)
  await enforceRateLimit(c.env, `password:user:${user.id}`)
  if (!(await verifyPassword(input.currentPassword, user.password_hash))) {
    await writeAudit(c.env.DB, { actorId: user.id, action: 'auth.password_change_failed', targetId: user.id, ip })
    throw new ApiError(400, 'invalid_credentials')
  }
  const config = getConfig(c.env)
  const newHash = await hashPassword(input.newPassword, config.passwordIterations)
  const session = await prepareSession(
    c.env.DB,
    { id: user.id, passwordHash: newHash },
    { ip, userAgent: c.req.header('user-agent') },
    config.sessionTtlMs,
  )
  // One atomic batch: new hash, sign out every device, then a fresh session for this one.
  await c.env.DB.batch([
    updatePasswordHashStatement(c.env.DB, user.id, newHash),
    deleteUserSessionsStatement(c.env.DB, user.id),
    session.statement,
  ])
  writeSessionCookie(c, session.token, session.expiresAt)
  await writeAudit(c.env.DB, { actorId: user.id, action: 'auth.password_changed', targetId: user.id, ip })
  return c.body(null, 204)
})
