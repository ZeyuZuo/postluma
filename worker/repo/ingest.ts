/**
 * Inbound-mail persistence. Unlike the user-facing repos, these functions run without a session:
 * the owning user is derived *only* from D1 — the mailbox row matched by the envelope recipient or,
 * for catch-all (personal mode), the domain row naming the administrator who switched it on.
 *
 * Every limit (mailbox/user active, hourly caps, service-wide daily message and byte budgets, the
 * catch-all caps) is re-checked inside the INSERTs themselves, so concurrent deliveries can't
 * overshoot and a mailbox disabled or a user banned mid-delivery gets nothing.
 */
import { isValidLocalPart } from '../../shared/api'
import type { PreparedMessage } from '../lib/mail-content'
import { settingIntSql } from './settings'

export interface DeliveryTarget {
  mailboxId: string
  userId: string
  /** The mailbox's own address. */
  address: string
  /** The envelope recipient as received (lowercased); differs from `address` for `local+tag@`. */
  recipient: string
  /** Delivered through `local+tag@`, which the mailbox must still accept when the row is written. */
  viaSubaddress: boolean
  /** Admin accounts are exempt from the per-mailbox and per-user hourly caps (not the daily budget). */
  isAdmin: boolean
  /**
   * Created by catch-all. Its address was chosen by the sender, so it gets no admin exemption: it is
   * capped per hour on its own, and all such addresses together to half of each daily budget.
   */
  autoCreated: boolean
  /** Catch-all: the mailbox doesn't exist yet and is created in the same transaction as the message. */
  create?: { domainId: string }
}

export type IngestBlock = 'flooded' | 'over_budget'
export type StoreResult = { stored: true; id: string } | { stored: false; reason: IngestBlock | 'unavailable' }

/** Deploy-time limits from worker/lib/config.ts. */
export interface IngestLimits {
  /** Personal mode: only mailboxes of administrators receive mail. */
  adminOwnersOnly: boolean
  perMailboxPerHour: number
  perUserPerHour: number
  messagesPerDay: number
  bytesPerDay: number
  /** Catch-all defaults; admin overrides in `settings` apply inside the SQL. */
  catchAllPerDay: number
  catchAllPerAddressPerHour: number
}

const HOUR_MS = 60 * 60 * 1000

// Shared parameter layout for the limit checks:
// ?1 mailbox id, ?2 user id, ?3 hour window start, ?4 UTC day key, ?5 bytes this message adds,
// ?21 per-mailbox/hour, ?22 per-user/hour, ?23 messages/day, ?24 bytes/day,
// ?31 messages per auto-created address per hour, ?32 addresses catch-all may create per day.
// storeMessage also uses ?6–?20 (the message), ?25 (1 = delivered via subaddress), ?26 (the recipient
// as received), ?27 (R2 key of the original, or null), ?28 (the verification link, or null), ?29 (auth
// results), ?30 (1 = only administrators' mailboxes receive mail: personal mode) and ?33 (the domain of
// a mailbox that catch-all creates).
const WITHIN_RATE = `(
  (SELECT COUNT(*) FROM messages WHERE mailbox_id = ?1 AND received_at > ?3) < ?21
  AND (SELECT COUNT(*) FROM messages WHERE user_id = ?2 AND received_at > ?3) < ?22)`
const WITHIN_BUDGET = `(
  COALESCE((SELECT messages FROM ingest_counters WHERE day = ?4), 0) < ?23
  AND COALESCE((SELECT bytes FROM ingest_counters WHERE day = ?4), 0) + ?5 <= ?24)`
/** Auto-created addresses together get half of each daily budget, so spam can't use it all up. */
const WITHIN_CATCH_ALL_SHARE = `(
  COALESCE((SELECT catch_all_messages FROM ingest_counters WHERE day = ?4), 0) < ?23 / 2
  AND COALESCE((SELECT catch_all_bytes FROM ingest_counters WHERE day = ?4), 0) + ?5 <= ?24 / 2)`
const WITHIN_ADDRESS_RATE = `(
  (SELECT COUNT(*) FROM messages WHERE mailbox_id = ?1 AND received_at > ?3)
  < ${settingIntSql('catch_all_max_per_address_per_hour', '?31')})`
const UNDER_CATCH_ALL_CAP = `(
  COALESCE((SELECT auto_created FROM ingest_counters WHERE day = ?4), 0) < ${settingIntSql('catch_all_max_per_day', '?32')})`
/**
 * The hourly limits by kind of mailbox (`m`, owner `u`): auto-created ones per address and within their
 * share of the day; administrators' own ones not at all; everyone else's per mailbox and per user.
 */
const WITHIN_MAILBOX_LIMITS = `(
  (m.auto_created = 1 AND ${WITHIN_ADDRESS_RATE} AND ${WITHIN_CATCH_ALL_SHARE})
  OR (m.auto_created = 0 AND (u.role = 'admin' OR ${WITHIN_RATE})))`

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/**
 * The mailbox a lowercased recipient resolves to: `local@domain` matches exactly; `local+tag@domain`
 * resolves to `local@domain` only if that mailbox opted into subaddressing. No other folding.
 */
export function deliveryAddress(recipient: string): { address: string; viaSubaddress: boolean } | null {
  const at = recipient.lastIndexOf('@')
  if (at <= 0) return null
  const local = recipient.slice(0, at)
  const plus = local.indexOf('+')
  if (plus === -1) return { address: recipient, viaSubaddress: false }
  if (plus === 0) return null
  return { address: `${local.slice(0, plus)}${recipient.slice(at)}`, viaSubaddress: true }
}

/**
 * Active mailbox of an active user (addresses are stored lowercase ASCII); in personal mode the user
 * must also be an administrator.
 */
export async function findDeliveryTarget(
  db: D1Database,
  recipient: string,
  opts: Pick<IngestLimits, 'adminOwnersOnly'>,
): Promise<DeliveryTarget | null> {
  const resolved = deliveryAddress(recipient)
  if (!resolved) return null
  const row = await db
    .prepare(
      `SELECT m.id AS mailbox_id, m.user_id, m.address, m.auto_created, u.role
       FROM mailboxes m JOIN users u ON u.id = m.user_id
       WHERE m.address = ?1 AND m.status = 'active' AND u.status = 'active' AND (?2 = 0 OR m.accept_subaddress = 1)
         AND (?3 = 0 OR u.role = 'admin')`,
    )
    .bind(resolved.address, resolved.viaSubaddress ? 1 : 0, opts.adminOwnersOnly ? 1 : 0)
    .first<{ mailbox_id: string; user_id: string; address: string; auto_created: number; role: string }>()
  return row
    ? {
        mailboxId: row.mailbox_id,
        userId: row.user_id,
        address: row.address,
        recipient,
        viaSubaddress: resolved.viaSubaddress,
        isAdmin: row.role === 'admin',
        autoCreated: row.auto_created === 1,
      }
    : null
}

/**
 * Catch-all lookup (exported for test/query-plans.test.ts), ?1 domain, ?2 address: the domain if it is
 * enabled and its catch-all owner is an active administrator, while the address is neither taken
 * (in any status: a disabled address keeps bouncing) nor retired.
 */
export const CATCH_ALL_TARGET_SQL = `
  SELECT d.id AS domain_id, d.catch_all_user_id AS user_id
  FROM domains d JOIN users u ON u.id = d.catch_all_user_id
  WHERE d.domain = ?1 AND d.enabled = 1 AND u.role = 'admin' AND u.status = 'active'
    AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE address = ?2)
    AND NOT EXISTS (SELECT 1 FROM retired_addresses WHERE address = ?2)`

/**
 * Personal mode, when no mailbox matched a lowercased recipient: a target that creates it (with id
 * `mailboxId`) for the domain's catch-all owner. Only strictly valid local parts qualify — no `+`, no
 * reserved names — so a subaddress never creates its base address and catch-all never claims a role
 * account.
 */
export async function findCatchAllTarget(db: D1Database, recipient: string, mailboxId: string): Promise<DeliveryTarget | null> {
  const at = recipient.lastIndexOf('@')
  if (at <= 0 || !isValidLocalPart(recipient.slice(0, at))) return null
  const row = await db
    .prepare(CATCH_ALL_TARGET_SQL)
    .bind(recipient.slice(at + 1), recipient)
    .first<{ domain_id: string; user_id: string }>()
  return row
    ? {
        mailboxId,
        userId: row.user_id,
        address: recipient,
        recipient,
        viaSubaddress: false,
        isAdmin: true,
        autoCreated: true,
        create: { domainId: row.domain_id },
      }
    : null
}

/** Bind values ?1–?32 for a limit check; the message placeholders (?6–?20, ?25–?30) are null. */
function checkParams(target: DeliveryTarget, now: number, bytes: number, limits: IngestLimits): unknown[] {
  return [
    target.mailboxId,
    target.userId,
    now - HOUR_MS,
    utcDay(now),
    bytes,
    ...Array<null>(15).fill(null),
    limits.perMailboxPerHour,
    limits.perUserPerHour,
    limits.messagesPerDay,
    limits.bytesPerDay,
    ...Array<null>(6).fill(null),
    limits.catchAllPerAddressPerHour,
    limits.catchAllPerDay,
  ]
}

/**
 * Which limit (if any) currently blocks this target. Used as a cheap pre-check before spending CPU
 * on parsing, and to explain a conditional INSERT that matched nothing. For an address catch-all
 * would create, any block means "don't create it".
 */
export async function ingestBlock(
  db: D1Database,
  target: DeliveryTarget,
  now: number,
  bytes: number,
  limits: IngestLimits,
): Promise<IngestBlock | null> {
  const row = await db
    .prepare(
      `SELECT ${WITHIN_RATE} AS within_rate, ${WITHIN_BUDGET} AS within_budget, ${WITHIN_CATCH_ALL_SHARE} AS within_share,
              ${WITHIN_ADDRESS_RATE} AS within_address_rate, ${UNDER_CATCH_ALL_CAP} AS under_cap`,
    )
    .bind(...checkParams(target, now, bytes, limits))
    .first<{ within_rate: number; within_budget: number; within_share: number; within_address_rate: number; under_cap: number }>()
  if (!row?.within_budget) return 'over_budget'
  if (!target.autoCreated) return !row.within_rate && !target.isAdmin ? 'flooded' : null
  if (!row.within_share) return 'over_budget'
  if (target.create) return row.under_cap ? null : 'flooded'
  return row.within_address_rate ? null : 'flooded'
}

/** R2 bytes of original messages stored so far on this UTC day. */
export async function rawBytesToday(db: D1Database, now: number): Promise<number> {
  const row = await db.prepare('SELECT raw_bytes FROM ingest_counters WHERE day = ?').bind(utcDay(now)).first<{ raw_bytes: number }>()
  return row?.raw_bytes ?? 0
}

/** Where the original of a stored message lives in R2. */
export interface StoredRaw {
  key: string
  bytes: number
}

/**
 * Stores the message (with `id`, chosen by the caller so the R2 key can be written first) and bumps
 * the daily counters in one transaction, if every limit still holds. A catch-all target's mailbox is
 * created in the same transaction; if the message isn't stored, neither is the mailbox.
 */
export async function storeMessage(
  db: D1Database,
  target: DeliveryTarget,
  id: string,
  message: PreparedMessage,
  raw: StoredRaw | null,
  receivedAt: number,
  limits: IngestLimits,
): Promise<StoreResult> {
  const day = utcDay(receivedAt)
  const params: unknown[] = [
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
    limits.perMailboxPerHour,
    limits.perUserPerHour,
    limits.messagesPerDay,
    limits.bytesPerDay,
    target.viaSubaddress ? 1 : 0,
    target.recipient,
    raw?.key ?? null,
    message.verificationLink,
    message.authResults,
    limits.adminOwnersOnly ? 1 : 0,
    limits.catchAllPerAddressPerHour,
    limits.catchAllPerDay,
    target.create?.domainId ?? null,
  ]
  const statements: D1PreparedStatement[] = []
  if (target.create) {
    // Every gate the message INSERT checks, so a mailbox created here always gets its first message
    // (same transaction). OR IGNORE: a concurrent first delivery may have created the address already.
    statements.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO mailboxes (id, user_id, domain_id, address, status, auto_created, created_at, updated_at)
           SELECT ?1, ?2, ?33, ?26, 'active', 1, ?20, ?20
           WHERE EXISTS (
               SELECT 1 FROM domains d JOIN users u ON u.id = d.catch_all_user_id
               WHERE d.id = ?33 AND d.catch_all_user_id = ?2 AND d.enabled = 1 AND u.role = 'admin' AND u.status = 'active')
             AND NOT EXISTS (SELECT 1 FROM retired_addresses WHERE address = ?26)
             AND ${UNDER_CATCH_ALL_CAP}
             AND ${WITHIN_BUDGET}
             AND ${WITHIN_CATCH_ALL_SHARE}`,
        )
        .bind(...params),
    )
  }
  statements.push(
    db
      .prepare(
        `INSERT INTO messages (id, mailbox_id, user_id, message_id_header, envelope_from, from_address, from_name,
           to_address, subject, snippet, text_body, html_body, verification_code, size, has_attachments,
           attachments_json, is_truncated, received_at, raw_r2_key, verification_link, auth_results)
         SELECT ?6, m.id, m.user_id, ?7, ?8, ?9, ?10, ?26, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?27, ?28, ?29
         FROM mailboxes m JOIN users u ON u.id = m.user_id
         WHERE m.id = ?1 AND m.user_id = ?2 AND m.status = 'active' AND u.status = 'active'
           AND (?25 = 0 OR m.accept_subaddress = 1)
           AND (?30 = 0 OR u.role = 'admin')
           AND ${WITHIN_MAILBOX_LIMITS}
           AND ${WITHIN_BUDGET}`,
      )
      // The highest placeholder here is ?31; D1 wants exactly that many values.
      .bind(...params.slice(0, 31)),
    db
      .prepare(
        // A message stored into an auto-created mailbox counts toward catch-all's share of the day;
        // ?5 = 1 when this transaction created that mailbox.
        `INSERT INTO ingest_counters (day, messages, bytes, raw_bytes, auto_created, catch_all_messages, catch_all_bytes)
         SELECT ?1, 1, ?2, ?4, ?5, m.auto_created, m.auto_created * ?2
         FROM messages g JOIN mailboxes m ON m.id = g.mailbox_id
         WHERE g.id = ?3
         ON CONFLICT (day) DO UPDATE SET messages = messages + 1, bytes = bytes + excluded.bytes,
           raw_bytes = raw_bytes + excluded.raw_bytes, auto_created = auto_created + excluded.auto_created,
           catch_all_messages = catch_all_messages + excluded.catch_all_messages,
           catch_all_bytes = catch_all_bytes + excluded.catch_all_bytes`,
      )
      .bind(day, message.storedBytes, id, raw?.bytes ?? 0, target.create ? 1 : 0),
  )
  const results = await db.batch(statements)
  if (results[target.create ? 1 : 0]?.meta.changes) return { stored: true, id }

  // Nothing inserted: find out why, for the right bounce text.
  const current = await findDeliveryTarget(db, target.recipient, limits)
  if (target.create) {
    // A concurrent first delivery may have created the same address for the same owner meanwhile:
    // deliver there, once. Anything else reads like an unknown address.
    if (current?.userId === target.userId) return storeMessage(db, current, id, message, raw, receivedAt, limits)
    return { stored: false, reason: 'unavailable' }
  }
  if (!current) return { stored: false, reason: 'unavailable' }
  return { stored: false, reason: (await ingestBlock(db, current, receivedAt, message.storedBytes, limits)) ?? 'flooded' }
}
