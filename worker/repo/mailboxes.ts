/**
 * Tenant-scoped mailbox access. Every function takes the session user's id first and every query
 * filters on it, so one user's mailbox ids are simply invisible (404) to everyone else.
 */
import type { MailboxQuota, MailboxStatus, PublicMailbox } from '../../shared/api'
import { newId } from '../lib/crypto'
import { ApiError } from '../lib/errors'
import { isUniqueViolation } from './users'

interface MailboxRow {
  id: string
  address: string
  domain: string
  note: string | null
  status: MailboxStatus
  message_count: number
  unread_count: number
  created_at: number
  last_received_at: number | null
}

const SELECT_MAILBOX = `
  SELECT m.id, m.address, d.domain, m.note, m.status, m.created_at, m.last_received_at,
         (SELECT COUNT(*) FROM messages g WHERE g.mailbox_id = m.id) AS message_count,
         (SELECT COUNT(*) FROM messages g WHERE g.mailbox_id = m.id AND g.is_read = 0) AS unread_count
  FROM mailboxes m JOIN domains d ON d.id = m.domain_id`

/** SQL condition: user ?1 has fewer active mailboxes than their effective quota. */
const UNDER_QUOTA = `
  (SELECT COUNT(*) FROM mailboxes WHERE user_id = ?1 AND status = 'active') <
  (SELECT COALESCE(u.mailbox_quota,
                   CAST((SELECT value FROM settings WHERE key = 'default_mailbox_quota') AS INTEGER), 0)
   FROM users u WHERE u.id = ?1)`

/**
 * SQL condition for creating a new row: total mailboxes (any status) and creations in the window
 * starting at ?7 stay under their admin-tunable caps. Missing settings rows fail closed.
 */
const UNDER_CREATION_LIMITS = `
  (SELECT COUNT(*) FROM mailboxes WHERE user_id = ?1) <
  (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'max_total_mailboxes')
  AND (SELECT COUNT(*) FROM mailboxes WHERE user_id = ?1 AND created_at > ?7) <
  (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'max_daily_mailbox_creations')`

const CREATION_WINDOW_MS = 24 * 60 * 60 * 1000

export const MAILBOX_PAGE_SIZE = 50

function toPublic(row: MailboxRow): PublicMailbox {
  return {
    id: row.id,
    address: row.address,
    domain: row.domain,
    note: row.note,
    status: row.status,
    messageCount: row.message_count,
    unreadCount: row.unread_count,
    createdAt: row.created_at,
    lastReceivedAt: row.last_received_at,
  }
}

function encodeCursor(row: MailboxRow): string {
  return btoa(`${row.created_at}:${row.id}`)
}

function decodeCursor(cursor: string): { createdAt: number; id: string } {
  try {
    const [createdAt, id] = atob(cursor).split(':')
    const n = Number(createdAt)
    if (Number.isSafeInteger(n) && id) return { createdAt: n, id }
  } catch {
    // fall through
  }
  throw new ApiError(400, 'invalid_input')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

export async function getQuota(db: D1Database, userId: string): Promise<MailboxQuota> {
  const row = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM mailboxes WHERE user_id = ?1 AND status = 'active') AS used,
         COALESCE(u.mailbox_quota,
                  CAST((SELECT value FROM settings WHERE key = 'default_mailbox_quota') AS INTEGER), 0) AS quota
       FROM users u WHERE u.id = ?1`,
    )
    .bind(userId)
    .first<{ used: number; quota: number }>()
  return { used: row?.used ?? 0, limit: Math.max(0, row?.quota ?? 0) }
}

export async function listMailboxes(
  db: D1Database,
  userId: string,
  opts: { status: MailboxStatus; q?: string; cursor?: string },
): Promise<{ items: PublicMailbox[]; nextCursor: string | null }> {
  const where = ['m.user_id = ?', 'm.status = ?']
  const params: unknown[] = [userId, opts.status]
  if (opts.q) {
    const pattern = `%${escapeLike(opts.q)}%`
    where.push("(m.address LIKE ? ESCAPE '\\' OR m.note LIKE ? ESCAPE '\\')")
    params.push(pattern, pattern)
  }
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor)
    where.push('(m.created_at < ? OR (m.created_at = ? AND m.id < ?))')
    params.push(c.createdAt, c.createdAt, c.id)
  }
  const { results } = await db
    .prepare(`${SELECT_MAILBOX} WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.id DESC LIMIT ?`)
    .bind(...params, MAILBOX_PAGE_SIZE + 1)
    .all<MailboxRow>()
  const page = results.slice(0, MAILBOX_PAGE_SIZE)
  const last = page.at(-1)
  return {
    items: page.map(toPublic),
    nextCursor: results.length > MAILBOX_PAGE_SIZE && last ? encodeCursor(last) : null,
  }
}

export async function getMailbox(db: D1Database, userId: string, id: string): Promise<PublicMailbox> {
  const row = await db
    .prepare(`${SELECT_MAILBOX} WHERE m.id = ? AND m.user_id = ?`)
    .bind(id, userId)
    .first<MailboxRow>()
  if (!row) throw new ApiError(404, 'not_found')
  return toPublic(row)
}

/** Explains why a conditional INSERT matched no rows, in the order users can act on. */
async function creationFailure(db: D1Database, userId: string, address: string, domainId: string, since: number): Promise<ApiError> {
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM retired_addresses WHERE address = ?2) AS retired,
         EXISTS (SELECT 1 FROM domains WHERE id = ?3 AND enabled = 1) AS domain_ok,
         (SELECT COUNT(*) FROM mailboxes WHERE user_id = ?1) AS total,
         (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'max_total_mailboxes') AS max_total,
         (SELECT COUNT(*) FROM mailboxes WHERE user_id = ?1 AND created_at > ?4) AS recent,
         (SELECT CAST(value AS INTEGER) FROM settings WHERE key = 'max_daily_mailbox_creations') AS max_recent`,
    )
    .bind(userId, address, domainId, since)
    .first<{ retired: number; domain_ok: number; total: number; max_total: number | null; recent: number; max_recent: number | null }>()
  if (row?.retired) return new ApiError(409, 'address_taken')
  if (!row?.domain_ok) return new ApiError(400, 'domain_unavailable')
  if (row.max_total === null || row.total >= row.max_total) return new ApiError(409, 'mailbox_total_limit_reached')
  if (row.max_recent === null || row.recent >= row.max_recent) return new ApiError(429, 'rate_limited')
  return new ApiError(409, 'mailbox_quota_exceeded')
}

/**
 * Creates an active mailbox. Quota, domain state and address reservation are all re-checked inside
 * the INSERT itself, so concurrent requests can't exceed the quota or claim a retired address.
 */
export async function createMailbox(
  db: D1Database,
  userId: string,
  input: { domainId: string; address: string; note: string | null },
): Promise<PublicMailbox> {
  const id = newId()
  const now = Date.now()
  const since = now - CREATION_WINDOW_MS
  let changes: number
  try {
    const result = await db
      .prepare(
        `INSERT INTO mailboxes (id, user_id, domain_id, address, note, status, created_at, updated_at)
         SELECT ?2, ?1, ?3, ?4, ?5, 'active', ?6, ?6
         WHERE NOT EXISTS (SELECT 1 FROM retired_addresses WHERE address = ?4)
           AND EXISTS (SELECT 1 FROM domains WHERE id = ?3 AND enabled = 1)
           AND ${UNDER_QUOTA}
           AND ${UNDER_CREATION_LIMITS}`,
      )
      .bind(userId, id, input.domainId, input.address, input.note, now, since)
      .run()
    changes = result.meta.changes
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'address_taken')
    throw err
  }
  if (!changes) throw await creationFailure(db, userId, input.address, input.domainId, since)
  return getMailbox(db, userId, id)
}

export async function updateMailbox(
  db: D1Database,
  userId: string,
  id: string,
  patch: { note?: string | null; status?: MailboxStatus },
): Promise<PublicMailbox> {
  const current = await getMailbox(db, userId, id)
  const now = Date.now()

  if (patch.status && patch.status !== current.status) {
    const result =
      patch.status === 'active'
        ? await db
            .prepare(
              `UPDATE mailboxes SET status = 'active', updated_at = ?3
               WHERE id = ?2 AND user_id = ?1 AND status = 'disabled' AND ${UNDER_QUOTA}`,
            )
            .bind(userId, id, now)
            .run()
        : await db
            .prepare("UPDATE mailboxes SET status = 'disabled', updated_at = ? WHERE id = ? AND user_id = ?")
            .bind(now, id, userId)
            .run()
    if (!result.meta.changes) {
      // Another request may already have made the same change; only a real quota miss is an error.
      const latest = await getMailbox(db, userId, id)
      if (latest.status !== patch.status) throw new ApiError(409, 'mailbox_quota_exceeded')
    }
  }

  if (patch.note !== undefined) {
    await db
      .prepare('UPDATE mailboxes SET note = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(patch.note, now, id, userId)
      .run()
  }
  return getMailbox(db, userId, id)
}
