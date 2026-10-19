/** Sessions are keyed by SHA-256(token); the raw token only ever exists in the client's cookie. */
import { randomBytes, sha256Hex, toBase64Url } from '../lib/crypto'
import type { UserRow } from './users'

/** Default only; deployments set `SESSION_TTL_DAYS` (worker/lib/config.ts). */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const TOKEN_BYTES = 32

export interface PendingSession {
  token: string
  expiresAt: number
  /** Inserts nothing unless the user is still active and still has `passwordHash`. */
  statement: D1PreparedStatement
}

/**
 * Builds a conditional session insert. Binding it to the password hash and status the caller just
 * verified closes the race where a password change, ban or rejection lands between the check and
 * the insert. Run it alone or inside `db.batch()` with the statements that must precede it.
 */
export async function prepareSession(
  db: D1Database,
  user: { id: string; passwordHash: string },
  meta: { ip: string; userAgent: string | undefined },
  ttlMs = SESSION_TTL_MS,
): Promise<PendingSession> {
  const token = toBase64Url(randomBytes(TOKEN_BYTES))
  const now = Date.now()
  const expiresAt = now + ttlMs
  const statement = db
    .prepare(
      `INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent)
       SELECT ?, id, ?, ?, ?, ? FROM users WHERE id = ? AND password_hash = ? AND status = 'active'`,
    )
    .bind(
      await sha256Hex(token),
      now,
      expiresAt,
      meta.ip,
      meta.userAgent?.slice(0, 256) ?? null,
      user.id,
      user.passwordHash,
    )
  return { token, expiresAt, statement }
}

/** Returns the session's user regardless of status; callers decide what each status may do. */
export async function findSessionUser(
  db: D1Database,
  token: string,
): Promise<{ sessionId: string; user: UserRow } | null> {
  const sessionId = await sha256Hex(token)
  const user = await db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(sessionId, Date.now())
    .first<UserRow>()
  return user ? { sessionId, user } : null
}

export async function deleteSessionByToken(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256Hex(token)).run()
}

export function deleteUserSessionsStatement(db: D1Database, userId: string): D1PreparedStatement {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId)
}
