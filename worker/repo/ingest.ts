/**
 * Inbound-mail persistence. Unlike the user-facing repos, these functions run without a session:
 * the owning user is derived *only* from the mailbox row matched by the envelope recipient.
 *
 * Every limit (mailbox/user active, per-mailbox and per-user hourly caps, service-wide daily
 * message and byte budgets) is re-checked inside the INSERT itself, so concurrent deliveries can't
 * overshoot and a mailbox disabled or a user banned mid-delivery gets nothing.
 */
import { newId } from '../lib/crypto'
import type { PreparedMessage } from '../lib/mail-content'

export interface DeliveryTarget {
  mailboxId: string
  userId: string
  address: string
  /** Admin accounts are exempt from the per-mailbox and per-user hourly caps (not the daily budget). */
  isAdmin: boolean
}

export type IngestBlock = 'flooded' | 'over_budget'
export type StoreResult = { stored: true; id: string } | { stored: false; reason: IngestBlock | 'unavailable' }

/** Deploy-time limits from worker/lib/config.ts. */
export interface IngestLimits {
  perMailboxPerHour: number
  perUserPerHour: number
  messagesPerDay: number
  bytesPerDay: number
}

const HOUR_MS = 60 * 60 * 1000

// Shared parameter layout for the limit checks:
// ?1 mailbox id, ?2 user id, ?3 hour window start, ?4 UTC day key, ?5 bytes this message adds,
// ?21 per-mailbox/hour, ?22 per-user/hour, ?23 messages/day, ?24 bytes/day.
const WITHIN_RATE = `(
  (SELECT COUNT(*) FROM messages WHERE mailbox_id = ?1 AND received_at > ?3) < ?21
  AND (SELECT COUNT(*) FROM messages WHERE user_id = ?2 AND received_at > ?3) < ?22)`
const WITHIN_BUDGET = `(
  COALESCE((SELECT messages FROM ingest_counters WHERE day = ?4), 0) < ?23
  AND COALESCE((SELECT bytes FROM ingest_counters WHERE day = ?4), 0) + ?5 <= ?24)`

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** Active mailbox of an active user, matched exactly (addresses are stored lowercase ASCII). */
export async function findDeliveryTarget(db: D1Database, recipient: string): Promise<DeliveryTarget | null> {
  const row = await db
    .prepare(
      `SELECT m.id AS mailbox_id, m.user_id, m.address, u.role
       FROM mailboxes m JOIN users u ON u.id = m.user_id
       WHERE m.address = ? AND m.status = 'active' AND u.status = 'active'`,
    )
    .bind(recipient)
    .first<{ mailbox_id: string; user_id: string; address: string; role: string }>()
  return row
    ? { mailboxId: row.mailbox_id, userId: row.user_id, address: row.address, isAdmin: row.role === 'admin' }
    : null
}

/** Bind values ?21–?24 (placeholders ?6–?20 belong to storeMessage; unused ones are bound as null). */
function limitParams(limits: IngestLimits): unknown[] {
  return [limits.perMailboxPerHour, limits.perUserPerHour, limits.messagesPerDay, limits.bytesPerDay]
}

/**
 * Which limit (if any) currently blocks this mailbox. Used as a cheap pre-check before spending
 * CPU on parsing, and to explain a conditional INSERT that matched nothing.
 */
export async function ingestBlock(
  db: D1Database,
  target: DeliveryTarget,
  now: number,
  bytes: number,
  limits: IngestLimits,
): Promise<IngestBlock | null> {
  const row = await db
    .prepare(`SELECT ${WITHIN_RATE} AS within_rate, ${WITHIN_BUDGET} AS within_budget`)
    .bind(
      target.mailboxId,
      target.userId,
      now - HOUR_MS,
      utcDay(now),
      bytes,
      ...Array<null>(15).fill(null),
      ...limitParams(limits),
    )
    .first<{ within_rate: number; within_budget: number }>()
  if (!row?.within_budget) return 'over_budget'
  if (!row.within_rate && !target.isAdmin) return 'flooded'
  return null
}

/** Stores the message and bumps the daily counter in one transaction, if every limit still holds. */
export async function storeMessage(
  db: D1Database,
  target: DeliveryTarget,
  message: PreparedMessage,
  receivedAt: number,
  limits: IngestLimits,
): Promise<StoreResult> {
  const id = newId()
  const day = utcDay(receivedAt)
  const [insert] = await db.batch([
    db
      .prepare(
        `INSERT INTO messages (id, mailbox_id, user_id, message_id_header, envelope_from, from_address, from_name,
           to_address, subject, snippet, text_body, html_body, verification_code, size, has_attachments,
           attachments_json, is_truncated, received_at)
         SELECT ?6, m.id, m.user_id, ?7, ?8, ?9, ?10, m.address, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20
         FROM mailboxes m JOIN users u ON u.id = m.user_id
         WHERE m.id = ?1 AND m.user_id = ?2 AND m.status = 'active' AND u.status = 'active'
           AND (u.role = 'admin' OR ${WITHIN_RATE})
           AND ${WITHIN_BUDGET}`,
      )
      .bind(
        target.mailboxId,
        target.userId,
        receivedAt - HOUR_MS,
        day,
        message.storedBytes,
        id,
        message.messageIdHeader,
        message.envelopeFrom,
        message.fromAddress,
        message.fromName,
        message.subject,
        message.snippet,
        message.textBody,
        message.htmlBody,
        message.verificationCode,
        message.size,
        message.hasAttachments ? 1 : 0,
        message.attachmentsJson,
        message.truncated ? 1 : 0,
        receivedAt,
        ...limitParams(limits),
      ),
    db
      .prepare(
        `INSERT INTO ingest_counters (day, messages, bytes)
         SELECT ?1, 1, ?2 WHERE EXISTS (SELECT 1 FROM messages WHERE id = ?3)
         ON CONFLICT (day) DO UPDATE SET messages = messages + 1, bytes = bytes + excluded.bytes`,
      )
      .bind(day, message.storedBytes, id),
  ])
  if (insert?.meta.changes) return { stored: true, id }
  // Nothing inserted: find out why, for the right bounce text.
  const current = await findDeliveryTarget(db, target.address)
  if (!current) return { stored: false, reason: 'unavailable' }
  return { stored: false, reason: (await ingestBlock(db, current, receivedAt, message.storedBytes, limits)) ?? 'flooded' }
}
