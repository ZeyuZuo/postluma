/**
 * Sent mail, tenant-scoped like `messages`: every query filters on the session user's id, and
 * someone else's ids behave like missing ones (404). Admins have no access to content here.
 *
 * Sending is two steps: `reserveSend()` inserts a 'sending' row only if every rule holds — the
 * mailbox is the user's own and active, the user and the mailbox's domain are allowed to send, and
 * both rolling-24 h quotas have room — in one conditional INSERT, so concurrent sends can't
 * overshoot. The route then calls the provider and `finishSend()` records the outcome.
 */
import {
  OUTBOX_PAGE_SIZE,
  type ErrorCode,
  type OutboxListResponse,
  type OutboxStatus,
  type SendErrorCode,
  type SentMessageDetail,
  type SentMessageSummary,
  type SentStatus,
} from '../../shared/api'
import { newId } from '../lib/crypto'
import { ApiError } from '../lib/errors'

const DAY_MS = 24 * 60 * 60 * 1000
const SNIPPET_CHARS = 200

export interface SendLimits {
  perUserPerDay: number
  perDay: number
}

/** The user's daily quota: their own override, else the deploy default bound at `limitParam`. */
const userQuotaOf = (userParam: string, limitParam: string) =>
  `(SELECT COALESCE(send_quota, ${limitParam}) FROM users WHERE id = ${userParam})`
/** Rows over the last 24 h that still count, capped at the quota so the read stays bounded. */
const userSendsSql = (userParam: string, sinceParam: string, limitParam: string) =>
  `(SELECT COUNT(*) FROM (SELECT 1 FROM sent_messages WHERE user_id = ${userParam} AND created_at > ${sinceParam} AND counted = 1 LIMIT ${userQuotaOf(userParam, limitParam)}))`
const allSendsSql = (sinceParam: string, capParam: string) =>
  `(SELECT COUNT(*) FROM (SELECT 1 FROM sent_messages WHERE created_at > ${sinceParam} AND counted = 1 LIMIT ${capParam}))`

export interface Reservation {
  id: string
  fromAddress: string
  /** Message-ID of the answered message, for In-Reply-To / References. */
  replyToHeader: string | null
  /** True when this idempotency key was already used: nothing new was reserved. */
  duplicate: boolean
}

export async function reserveSend(
  db: D1Database,
  userId: string,
  input: { mailboxId: string; to: string[]; subject: string; text: string; replyToId?: string; idempotencyKey: string },
  limits: SendLimits,
  provider: string,
  ip: string,
  now = Date.now(),
): Promise<Reservation> {
  const id = newId()
  const since = now - DAY_MS
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO sent_messages (id, user_id, mailbox_id, from_address, to_addresses, subject, text_body, reply_to_id,
           status, provider, idempotency_key, created_at, updated_at)
         SELECT ?1, u.id, m.id, m.address, ?4, ?5, ?6, ?7, 'sending', ?8, ?9, ?10, ?10
         FROM mailboxes m CROSS JOIN users u CROSS JOIN domains d
         WHERE m.id = ?3 AND m.user_id = ?2 AND u.id = m.user_id AND d.id = m.domain_id
           AND m.status = 'active' AND u.status = 'active' AND u.can_send = 1 AND d.can_send = 1
           AND (?7 IS NULL OR EXISTS (SELECT 1 FROM messages WHERE id = ?7 AND user_id = ?2))
           AND ${userSendsSql('?2', '?11', '?12')} < ${userQuotaOf('?2', '?12')}
           AND ${allSendsSql('?11', '?13')} < ?13
         ON CONFLICT (user_id, idempotency_key) DO NOTHING`,
      )
      .bind(
        id,
        userId,
        input.mailboxId,
        JSON.stringify(input.to),
        input.subject,
        input.text,
        input.replyToId ?? null,
        provider,
        input.idempotencyKey,
        now,
        since,
        limits.perUserPerDay,
        limits.perDay,
      ),
    // Batched with the reservation and conditional on it: one audit row per send, metadata only.
    db.prepare(
      `INSERT INTO audit_logs (id, actor_id, action, target_id, detail, ip, created_at)
       SELECT ?1, ?2, 'mail.send', ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM sent_messages WHERE id = ?3)`,
    ).bind(newId(), userId, id, JSON.stringify({ recipients: input.to.length, reply: Boolean(input.replyToId) }), ip, now),
  ])

  if (insert?.meta.changes) {
    const row = await db
      .prepare(
        `SELECT s.from_address, g.message_id_header FROM sent_messages s LEFT JOIN messages g ON g.id = s.reply_to_id
         WHERE s.id = ? AND s.user_id = ?`,
      )
      .bind(id, userId)
      .first<{ from_address: string; message_id_header: string | null }>()
    return { id, fromAddress: row!.from_address, replyToHeader: row!.message_id_header, duplicate: false }
  }

  const existing = await db
    .prepare('SELECT id, from_address FROM sent_messages WHERE user_id = ? AND idempotency_key = ?')
    .bind(userId, input.idempotencyKey)
    .first<{ id: string; from_address: string }>()
  if (existing) return { id: existing.id, fromAddress: existing.from_address, replyToHeader: null, duplicate: true }
  throw new ApiError(...(await reserveFailure(db, userId, input, limits, since)))
}

/** Picks the error after a refused reservation (the INSERT itself is what enforces the rules). */
async function reserveFailure(
  db: D1Database,
  userId: string,
  input: { mailboxId: string; replyToId?: string },
  limits: SendLimits,
  since: number,
): Promise<[403 | 404 | 429, ErrorCode]> {
  const row = await db
    .prepare(
      `SELECT m.status AS mailbox_status, u.can_send AS user_can, d.can_send AS domain_can,
              (?3 IS NULL OR EXISTS (SELECT 1 FROM messages WHERE id = ?3 AND user_id = ?1)) AS reply_ok,
              ${userSendsSql('?1', '?4', '?5')} >= ${userQuotaOf('?1', '?5')} AS user_full,
              ${allSendsSql('?4', '?6')} >= ?6 AS all_full
       FROM mailboxes m CROSS JOIN users u CROSS JOIN domains d
       WHERE m.id = ?2 AND m.user_id = ?1 AND u.id = m.user_id AND d.id = m.domain_id`,
    )
    .bind(userId, input.mailboxId, input.replyToId ?? null, since, limits.perUserPerDay, limits.perDay)
    .first<{ mailbox_status: string; user_can: number; domain_can: number; reply_ok: number; user_full: number; all_full: number }>()
  if (!row || row.reply_ok !== 1) return [404, 'not_found']
  if (row.user_can !== 1) return [403, 'sending_not_allowed']
  if (row.mailbox_status !== 'active' || row.domain_can !== 1) return [403, 'sending_domain_not_allowed']
  if (row.user_full === 1) return [429, 'send_quota_exceeded']
  return [429, row.all_full === 1 ? 'send_daily_limit_reached' : 'send_quota_exceeded']
}

export async function finishSend(
  db: D1Database,
  id: string,
  result: { ok: true; providerId: string } | { ok: false; error: SendErrorCode; refund: boolean },
  now = Date.now(),
): Promise<void> {
  const stmt = result.ok
    ? db.prepare("UPDATE sent_messages SET status = 'sent', provider_id = ?2, updated_at = ?3 WHERE id = ?1").bind(id, result.providerId, now)
    : db
        .prepare("UPDATE sent_messages SET status = 'failed', error = ?2, counted = ?3, updated_at = ?4 WHERE id = ?1")
        .bind(id, result.error, result.refund ? 0 : 1, now)
  await stmt.run()
}

interface SentRow {
  id: string
  mailbox_id: string
  from_address: string
  to_addresses: string
  subject: string
  text_body: string
  status: SentStatus
  error: SendErrorCode | null
  reply_to_id: string | null
  created_at: number
}

function toSummary(row: SentRow): SentMessageSummary {
  return {
    id: row.id,
    mailboxId: row.mailbox_id,
    fromAddress: row.from_address,
    to: JSON.parse(row.to_addresses) as string[],
    subject: row.subject,
    snippet: row.text_body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS),
    status: row.status,
    error: row.error,
    replyToId: row.reply_to_id,
    createdAt: row.created_at,
  }
}

export async function getSent(db: D1Database, userId: string, id: string): Promise<SentMessageDetail> {
  const row = await db.prepare('SELECT * FROM sent_messages WHERE id = ? AND user_id = ?').bind(id, userId).first<SentRow>()
  if (!row) throw new ApiError(404, 'not_found')
  return { ...toSummary(row), text: row.text_body }
}

export async function listSent(db: D1Database, userId: string, cursor?: string): Promise<OutboxListResponse> {
  const params: unknown[] = [userId]
  let where = 'user_id = ?'
  if (cursor) {
    const [at, id] = (() => {
      try {
        const [a, b] = atob(cursor).split(':')
        return [Number(a), b]
      } catch {
        return [NaN, undefined]
      }
    })()
    if (!Number.isFinite(at) || !id) throw new ApiError(400, 'invalid_input')
    where += ' AND (created_at, id) < (?, ?)'
    params.push(at, id)
  }
  const { results } = await db
    .prepare(`SELECT * FROM sent_messages WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ${OUTBOX_PAGE_SIZE + 1}`)
    .bind(...params)
    .all<SentRow>()
  const page = results.slice(0, OUTBOX_PAGE_SIZE)
  const last = page.at(-1)
  return {
    items: page.map(toSummary),
    nextCursor: results.length > OUTBOX_PAGE_SIZE && last ? btoa(`${last.created_at}:${last.id}`) : null,
  }
}

export async function getOutboxStatus(
  db: D1Database,
  userId: string,
  enabled: boolean,
  limits: SendLimits & { maxRecipients: number },
  now = Date.now(),
): Promise<OutboxStatus> {
  const closed: OutboxStatus = { canSend: false, remaining: 0, limit: 0, maxRecipients: limits.maxRecipients, mailboxIds: [] }
  if (!enabled) return closed
  const user = await db
    .prepare(
      `SELECT u.can_send, ${userQuotaOf('?1', '?3')} AS quota, ${userSendsSql('?1', '?2', '?3')} AS used
       FROM users u WHERE u.id = ?1 AND u.status = 'active'`,
    )
    .bind(userId, now - DAY_MS, limits.perUserPerDay)
    .first<{ can_send: number; quota: number; used: number }>()
  if (!user || user.can_send !== 1) return closed
  const { results } = await db
    .prepare(
      `SELECT m.id FROM mailboxes m CROSS JOIN domains d
       WHERE m.user_id = ? AND m.status = 'active' AND d.id = m.domain_id AND d.can_send = 1
       ORDER BY m.created_at DESC`,
    )
    .bind(userId)
    .all<{ id: string }>()
  return {
    canSend: results.length > 0,
    remaining: Math.max(0, user.quota - user.used),
    limit: user.quota,
    maxRecipients: limits.maxRecipients,
    mailboxIds: results.map((r) => r.id),
  }
}

