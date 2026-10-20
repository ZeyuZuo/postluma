/**
 * Account administration. Returns account metadata and aggregate counts only — never mailbox
 * addresses or anything from users' mail. Admin accounts can't be suspended or deleted here, so the
 * only admin can never lock themselves out.
 */
import type { AdminUser, AdminUserAction, AdminUserListResponse, BatchDeleteResponse, UserStatus } from '../../shared/api'
import { ApiError } from '../lib/errors'
import { deleteBatch } from './maintenance'
import type { UserRow } from './users'

const PAGE_SIZE = 50
/** A user may be deleted with at most this many messages left (they go via cascade). */
export const DELETE_REMAINDER_MAX = 100

const TRANSITIONS: Record<AdminUserAction, { from: UserStatus[]; to: UserStatus }> = {
  approve: { from: ['pending', 'rejected'], to: 'active' },
  reject: { from: ['pending'], to: 'rejected' },
  ban: { from: ['active'], to: 'banned' },
  unban: { from: ['banned'], to: 'active' },
}

interface AdminUserRow {
  id: string
  username: string
  role: AdminUser['role']
  status: UserStatus
  mailbox_quota: number | null
  active_mailboxes: number
  total_mailboxes: number
  created_at: number
  last_login_at: number | null
}

function toAdminUser(r: AdminUserRow): AdminUser {
  return {
    id: r.id,
    username: r.username,
    role: r.role,
    status: r.status,
    mailboxQuota: r.mailbox_quota,
    activeMailboxes: r.active_mailboxes,
    totalMailboxes: r.total_mailboxes,
    createdAt: r.created_at,
    lastLoginAt: r.last_login_at,
  }
}

function decodeCursor(cursor: string): [number, string] {
  try {
    const [createdAt, id] = atob(cursor).split(':')
    const n = Number(createdAt)
    if (Number.isSafeInteger(n) && id) return [n, id]
  } catch {
    // fall through
  }
  throw new ApiError(400, 'invalid_input')
}

export async function listUsers(
  db: D1Database,
  opts: { status?: UserStatus; q?: string; cursor?: string },
): Promise<AdminUserListResponse> {
  const where: string[] = []
  const params: unknown[] = []
  if (opts.status) {
    where.push('u.status = ?')
    params.push(opts.status)
  }
  if (opts.q) {
    where.push("u.username LIKE ? ESCAPE '\\'")
    params.push(`%${opts.q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`)
  }
  if (opts.cursor) {
    where.push('(u.created_at, u.id) < (?, ?)')
    params.push(...decodeCursor(opts.cursor))
  }
  const { results } = await db
    .prepare(
      `SELECT u.id, u.username, u.role, u.status, u.mailbox_quota, u.created_at, u.last_login_at,
              (SELECT COUNT(*) FROM mailboxes WHERE user_id = u.id AND status = 'active') AS active_mailboxes,
              (SELECT COUNT(*) FROM mailboxes WHERE user_id = u.id) AS total_mailboxes
       FROM users u ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY u.created_at DESC, u.id DESC LIMIT ?`,
    )
    .bind(...params, PAGE_SIZE + 1)
    .all<AdminUserRow>()
  // The badge count is only needed with the first page (indexed via idx_users_status).
  const pending = opts.cursor
    ? null
    : await db.prepare("SELECT COUNT(*) AS n FROM users WHERE status = 'pending'").first<{ n: number }>()
  const page = results.slice(0, PAGE_SIZE)
  const last = page.at(-1)
  return {
    items: page.map(toAdminUser),
    nextCursor: results.length > PAGE_SIZE && last ? btoa(`${last.created_at}:${last.id}`) : null,
    pendingCount: pending ? pending.n : null,
  }
}

async function getTarget(db: D1Database, id: string): Promise<UserRow> {
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>()
  if (!user) throw new ApiError(404, 'not_found')
  return user
}

/**
 * Applies a status transition. Leaving `active` deletes every session in the same batch, so the
 * change takes effect immediately (requireUser also re-checks status on each request).
 */
export async function applyUserAction(
  db: D1Database,
  targetId: string,
  action: AdminUserAction,
  audit: D1PreparedStatement,
): Promise<UserStatus> {
  const user = await getTarget(db, targetId)
  if (user.role === 'admin') throw new ApiError(403, 'cannot_modify_admin')
  const rule = TRANSITIONS[action]
  if (!rule.from.includes(user.status)) throw new ApiError(409, 'invalid_state')
  const statements = [
    // Conditional on the status we just checked, so two admins racing can't skip a state.
    db
      .prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
      .bind(rule.to, Date.now(), targetId, user.status),
  ]
  if (rule.to !== 'active') statements.push(db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId))
  // Audit only if the conditional update applied (same transaction).
  const [update] = await db.batch(statements)
  if (!update?.meta.changes) throw new ApiError(409, 'invalid_state')
  await audit.run()
  return rule.to
}

export async function setUserQuota(db: D1Database, targetId: string, quota: number | null, audit: D1PreparedStatement): Promise<void> {
  await getTarget(db, targetId)
  await db.batch([
    db.prepare('UPDATE users SET mailbox_quota = ?, updated_at = ? WHERE id = ?').bind(quota, Date.now(), targetId),
    audit,
  ])
}

/** Counted up to `cap` so a huge mailbox history can't cost a full scan. */
export async function countUserMessages(db: D1Database, targetId: string, cap = 10_000): Promise<number> {
  await getTarget(db, targetId)
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages WHERE user_id = ? LIMIT ?)')
    .bind(targetId, cap)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** One budgeted batch of a user's messages (oldest first). Never reads their content. */
export async function purgeUserMessages(
  db: D1Database,
  bucket: R2Bucket | null,
  targetId: string,
  maxDeletesPerDay: number,
): Promise<BatchDeleteResponse> {
  const user = await getTarget(db, targetId)
  if (user.role === 'admin') throw new ApiError(403, 'cannot_modify_admin')
  return deleteBatch(db, bucket, { kind: 'user', userId: targetId }, maxDeletesPerDay)
}

/**
 * Deletes an account. It must not be active (ban it first, which stops ingest and logins), and its
 * mail must have been purged in budgeted batches down to DELETE_REMAINDER_MAX (stragglers cascade).
 * Addresses move to `retired_addresses` (never reusable); sessions/mailboxes/messages cascade;
 * the audit row is written in the same transaction.
 */
export async function deleteUser(
  db: D1Database,
  targetId: string,
  audit: (username: string) => D1PreparedStatement,
): Promise<void> {
  const user = await getTarget(db, targetId)
  if (user.role === 'admin') throw new ApiError(403, 'cannot_modify_admin')
  if (user.status === 'active') throw new ApiError(409, 'invalid_state')
  const left = await db
    .prepare('SELECT COUNT(*) AS n FROM (SELECT 1 FROM messages WHERE user_id = ? LIMIT ?)')
    .bind(targetId, DELETE_REMAINDER_MAX + 1)
    .first<{ n: number }>()
  if ((left?.n ?? 0) > DELETE_REMAINDER_MAX) throw new ApiError(409, 'user_has_messages')
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO retired_addresses (address, retired_at) SELECT address, ? FROM mailboxes WHERE user_id = ?')
      .bind(Date.now(), targetId),
    audit(user.username),
    db.prepare('DELETE FROM users WHERE id = ?').bind(targetId),
  ])
}
