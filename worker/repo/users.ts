/**
 * Account-level queries. These operate on a single known user id (the session's own user, or an
 * admin acting on accounts) — tenant-scoped data (mailboxes, messages) lives in other repo modules.
 */
import type { Locale, PublicUser, UserRole, UserStatus } from '../../shared/api'
import { newId } from '../lib/crypto'

export interface UserRow {
  id: string
  username: string
  password_hash: string
  role: UserRole
  status: UserStatus
  mailbox_quota: number | null
  /** Phase 9: allowed to send (on top of the service-wide switch). */
  can_send: number
  /** Sends per rolling 24 h; null = SEND_MAX_PER_USER_PER_DAY. */
  send_quota: number | null
  locale: Locale | null
  created_at: number
  updated_at: number
  last_login_at: number | null
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    locale: row.locale,
    createdAt: row.created_at,
  }
}

export function findUserByUsername(db: D1Database, username: string): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM users WHERE username = ?').bind(username).first<UserRow>()
}

export async function insertUser(
  db: D1Database,
  input: { username: string; passwordHash: string; role: UserRole; status: UserStatus },
): Promise<string> {
  const id = newId()
  const now = Date.now()
  await db
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.username, input.passwordHash, input.role, input.status, now, now)
    .run()
  return id
}

export async function hasAdmin(db: D1Database): Promise<boolean> {
  const row = await db.prepare("SELECT 1 AS found FROM users WHERE role = 'admin' LIMIT 1").first()
  return row !== null
}

export async function touchLastLogin(db: D1Database, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(Date.now(), userId).run()
}

export function updatePasswordHashStatement(db: D1Database, userId: string, hash: string): D1PreparedStatement {
  return db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').bind(hash, Date.now(), userId)
}

export async function updateLocale(db: D1Database, userId: string, locale: Locale | null): Promise<void> {
  await db
    .prepare('UPDATE users SET locale = ?, updated_at = ? WHERE id = ?')
    .bind(locale, Date.now(), userId)
    .run()
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed')
}
