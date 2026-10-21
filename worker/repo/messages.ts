/**
 * Tenant-scoped message access. Every query filters on the session user's id, so another user's
 * message ids behave exactly like non-existent ones (404). Admins get no special access here.
 */
import {
  MARK_READ_BATCH,
  SEARCH_WINDOW,
  UNREAD_COUNT_CAP,
  type InboxSummary,
  type MailboxStatus,
  type MessageAttachment,
  type MessageDetail,
  type MessageListResponse,
  type MessageSummary,
} from '../../shared/api'
import { ApiError } from '../lib/errors'

/*
 * D1 read budget (Free plan: 5M rows/day) shapes these queries:
 * - `CROSS JOIN` pins `messages` as the outer loop. With a plain JOIN, once SQLite has statistics
 *   (ANALYZE / PRAGMA optimize) the planner may scan *every* mailbox and sort — 12k rows read for
 *   a 50-item page in review measurements instead of ~170. test/query-plans.test.ts guards this.
 * - Cursors compare row values `(received_at, id) < (?, ?)`, which is an index range; the
 *   equivalent OR form scanned every newer row on each "load more".
 */
const FROM_MESSAGES = 'FROM messages g CROSS JOIN mailboxes m ON m.id = g.mailbox_id'

interface SummaryRow {
  id: string
  mailbox_id: string
  mailbox_address: string
  mailbox_note: string | null
  mailbox_status: MailboxStatus
  from_address: string
  from_name: string | null
  subject: string | null
  snippet: string | null
  verification_code: string | null
  verification_link: string | null
  is_read: number
  has_attachments: number
  received_at: number
}

interface DetailRow extends SummaryRow {
  to_address: string
  envelope_from: string | null
  text_body: string | null
  html_body: string | null
  is_truncated: number
  size: number
  attachments_json: string | null
  has_raw: number
}

const SUMMARY_COLUMNS = `g.id, g.mailbox_id, m.address AS mailbox_address, m.note AS mailbox_note, m.status AS mailbox_status,
  g.from_address, g.from_name, g.subject, g.snippet, g.verification_code, g.verification_link, g.is_read, g.has_attachments, g.received_at`

function toSummary(row: SummaryRow): MessageSummary {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    mailboxAddress: row.mailbox_address,
    mailboxNote: row.mailbox_note,
    mailboxStatus: row.mailbox_status,
    fromAddress: row.from_address,
    fromName: row.from_name,
    subject: row.subject ?? '',
    snippet: row.snippet ?? '',
    verificationCode: row.verification_code,
    verificationLink: row.verification_link,
    isRead: row.is_read === 1,
    hasAttachments: row.has_attachments === 1,
    receivedAt: row.received_at,
  }
}

function parseAttachments(json: string | null): MessageAttachment[] {
  if (!json) return []
  try {
    const items = JSON.parse(json) as { filename: string | null; contentType: string; size: number; inline: boolean }[]
    return items.map((a) => ({ filename: a.filename, contentType: a.contentType, size: a.size, inline: a.inline }))
  } catch {
    return []
  }
}

function encodeCursor(row: SummaryRow): string {
  return btoa(`${row.received_at}:${row.id}`)
}

function decodeCursor(cursor: string): { receivedAt: number; id: string } {
  try {
    const [receivedAt, id] = atob(cursor).split(':')
    const n = Number(receivedAt)
    if (Number.isSafeInteger(n) && id) return { receivedAt: n, id }
  } catch {
    // fall through
  }
  throw new ApiError(400, 'invalid_input')
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`)
}

/** Cheap ownership check (one indexed row); 404 unless the mailbox is this user's. */
async function assertOwnMailbox(db: D1Database, userId: string, mailboxId: string): Promise<void> {
  const row = await db.prepare('SELECT 1 AS ok FROM mailboxes WHERE id = ? AND user_id = ?').bind(mailboxId, userId).first()
  if (!row) throw new ApiError(404, 'not_found')
}

export interface ListMessagesOptions {
  /** One mailbox (any status). Without it: every *active* mailbox (the global inbox). */
  mailboxId?: string
  q?: string
  cursor?: string
  since?: number
  unreadOnly?: boolean
  withCodeOnly?: boolean
  limit: number
}

/**
 * SQL for a listing (without the mailbox ownership check, which listMessages does first).
 * Exported so test/query-plans.test.ts can EXPLAIN exactly what runs.
 */
export function buildListQuery(userId: string, opts: ListMessagesOptions): { sql: string; params: unknown[] } {
  const where = ['g.user_id = ?']
  const params: unknown[] = [userId]
  if (opts.mailboxId) {
    where.push('g.mailbox_id = ?')
    params.push(opts.mailboxId)
  } else {
    where.push("m.status = 'active'")
  }
  if (opts.q) {
    const p = `%${escapeLike(opts.q)}%`
    where.push(
      "(g.subject LIKE ? ESCAPE '\\' OR g.from_address LIKE ? ESCAPE '\\' OR g.from_name LIKE ? ESCAPE '\\' OR g.snippet LIKE ? ESCAPE '\\')",
    )
    params.push(p, p, p, p)
    // Search only the newest SEARCH_WINDOW messages: LIKE can't use an index, so bound the scan.
    where.push(
      `g.received_at >= COALESCE((SELECT received_at FROM messages WHERE user_id = ? ORDER BY received_at DESC LIMIT 1 OFFSET ${SEARCH_WINDOW - 1}), 0)`,
    )
    params.push(userId)
  }
  if (opts.unreadOnly) where.push('g.is_read = 0')
  // Must match idx_messages_user_verify's condition for the partial index to apply.
  if (opts.withCodeOnly) where.push('(g.verification_code IS NOT NULL OR g.verification_link IS NOT NULL)')
  if (opts.since !== undefined) {
    where.push('g.received_at > ?')
    params.push(opts.since)
  }
  if (opts.cursor) {
    const c = decodeCursor(opts.cursor)
    where.push('(g.received_at, g.id) < (?, ?)')
    params.push(c.receivedAt, c.id)
  }
  params.push(opts.limit + 1)
  return {
    sql: `SELECT ${SUMMARY_COLUMNS} ${FROM_MESSAGES}
       WHERE ${where.join(' AND ')} ORDER BY g.received_at DESC, g.id DESC LIMIT ?`,
    params,
  }
}

export async function listMessages(
  db: D1Database,
  userId: string,
  opts: ListMessagesOptions,
): Promise<MessageListResponse> {
  if (opts.mailboxId) await assertOwnMailbox(db, userId, opts.mailboxId)
  const { sql, params } = buildListQuery(userId, opts)
  const { results } = await db.prepare(sql).bind(...params).all<SummaryRow>()
  const page = results.slice(0, opts.limit)
  const last = page.at(-1)
  return { items: page.map(toSummary), nextCursor: results.length > opts.limit && last ? encodeCursor(last) : null }
}

export async function getMessage(db: D1Database, userId: string, id: string): Promise<MessageDetail> {
  const row = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS}, g.to_address, g.envelope_from, g.text_body, g.html_body, g.is_truncated, g.size,
              g.attachments_json, g.raw_r2_key IS NOT NULL AS has_raw
       ${FROM_MESSAGES}
       WHERE g.id = ? AND g.user_id = ?`,
    )
    .bind(id, userId)
    .first<DetailRow>()
  if (!row) throw new ApiError(404, 'not_found')
  return {
    ...toSummary(row),
    toAddress: row.to_address,
    envelopeFrom: row.envelope_from,
    textBody: row.text_body,
    htmlBody: row.html_body,
    isTruncated: row.is_truncated === 1,
    size: row.size,
    attachments: parseAttachments(row.attachments_json),
    hasRaw: row.has_raw === 1,
  }
}

/** R2 key of a message's original; 404 unless it is this user's and an original was kept. */
export async function getRawKey(db: D1Database, userId: string, id: string): Promise<string> {
  const row = await db
    .prepare('SELECT raw_r2_key FROM messages WHERE id = ? AND user_id = ?')
    .bind(id, userId)
    .first<{ raw_r2_key: string | null }>()
  if (!row?.raw_r2_key) throw new ApiError(404, 'not_found')
  return row.raw_r2_key
}

export async function setMessageRead(db: D1Database, userId: string, id: string, isRead: boolean): Promise<void> {
  const result = await db
    .prepare('UPDATE messages SET is_read = ? WHERE id = ? AND user_id = ?')
    .bind(isRead ? 1 : 0, id, userId)
    .run()
  if (!result.meta.changes) throw new ApiError(404, 'not_found')
}

/** Deletes one of the user's messages and returns its R2 key (if any) for the caller to remove. */
export async function deleteMessage(db: D1Database, userId: string, id: string): Promise<string | null> {
  const row = await db
    .prepare('DELETE FROM messages WHERE id = ? AND user_id = ? RETURNING raw_r2_key')
    .bind(id, userId)
    .first<{ raw_r2_key: string | null }>()
  if (!row) throw new ApiError(404, 'not_found')
  return row.raw_r2_key
}

/**
 * Marks up to MARK_READ_BATCH unread messages read — in one mailbox, or across all active
 * mailboxes. Bounded so one click on a huge backlog can't spend the shared daily D1 write budget;
 * the client calls again while `updated === MARK_READ_BATCH`.
 */
export async function markAllRead(db: D1Database, userId: string, mailboxId?: string): Promise<number> {
  if (mailboxId) await assertOwnMailbox(db, userId, mailboxId)
  const scope = mailboxId
    ? 'mailbox_id = ?2'
    : "mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = ?1 AND status = 'active')"
  const r = await db
    .prepare(
      `UPDATE messages SET is_read = 1 WHERE id IN (
         SELECT id FROM messages WHERE user_id = ?1 AND ${scope} AND is_read = 0 LIMIT ${MARK_READ_BATCH})`,
    )
    .bind(...(mailboxId ? [userId, mailboxId] : [userId]))
    .run()
  return r.meta.changes
}

/**
 * Poll target. Unchanged (`known` equals the latest arrival): one index seek, no count. Otherwise
 * the unread count walks the per-mailbox unread partial index, stopping at UNREAD_COUNT_CAP.
 */
export async function getInboxSummary(
  db: D1Database,
  userId: string,
  opts: { known?: number; recount?: boolean } = {},
): Promise<InboxSummary> {
  const latest = await db
    .prepare('SELECT MAX(received_at) AS latest FROM messages WHERE user_id = ?')
    .bind(userId)
    .first<{ latest: number | null }>()
  const latestReceivedAt = latest?.latest ?? null
  if (!opts.recount && opts.known !== undefined && opts.known === latestReceivedAt) {
    return { unread: null, latestReceivedAt }
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS unread FROM (
         SELECT 1 FROM messages
         WHERE mailbox_id IN (SELECT id FROM mailboxes WHERE user_id = ? AND status = 'active') AND is_read = 0
         LIMIT ${UNREAD_COUNT_CAP})`,
    )
    .bind(userId)
    .first<{ unread: number }>()
  return { unread: row?.unread ?? 0, latestReceivedAt }
}
