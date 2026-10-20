/**
 * Every bulk deletion of messages goes through here. Deleting a message costs ~6 D1 row writes,
 * and the Free plan's 100k writes/day are shared by login, ingest and everything else, so all
 * bulk deletes (retention cron, admin user purge, admin manual cleanup) draw from one per-UTC-day
 * budget (`MAX_DELETES_PER_DAY`, counted in ingest_counters.deleted). Single-message deletes by
 * their owner are not budgeted. Originals in R2 (if any) are removed with their rows; R2 deletes are
 * free and don't touch D1.
 */
import type { BatchDeleteResponse } from '../../shared/api'
import { deleteRaw } from '../lib/raw-mail'
import { utcDay } from './ingest'

export const DELETE_BATCH = 500

/** Which messages a bulk delete targets, oldest first. */
export type DeleteScope = { kind: 'olderThan'; cutoff: number } | { kind: 'user'; userId: string }

function scopeSql(scope: DeleteScope): { where: string; params: unknown[] } {
  return scope.kind === 'olderThan'
    ? { where: 'received_at < ?', params: [scope.cutoff] }
    : { where: 'user_id = ?', params: [scope.userId] }
}

export async function remainingDeletes(db: D1Database, maxPerDay: number, now = Date.now()): Promise<number> {
  const row = await db.prepare('SELECT deleted FROM ingest_counters WHERE day = ?').bind(utcDay(now)).first<{ deleted: number }>()
  return Math.max(0, maxPerDay - (row?.deleted ?? 0))
}

/** Deletes one batch within today's budget and records it. */
export async function deleteBatch(
  db: D1Database,
  bucket: R2Bucket | null,
  scope: DeleteScope,
  maxPerDay: number,
  now = Date.now(),
): Promise<BatchDeleteResponse> {
  const remaining = await remainingDeletes(db, maxPerDay, now)
  if (remaining === 0) return { deleted: 0, done: false, budgetExhausted: true }
  const limit = Math.min(DELETE_BATCH, remaining)
  const { where, params } = scopeSql(scope)
  const { results, meta } = await db
    .prepare(
      `DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE ${where} ORDER BY received_at LIMIT ?)
       RETURNING raw_r2_key`,
    )
    .bind(...params, limit)
    .all<{ raw_r2_key: string | null }>()
  await deleteRaw(bucket, results.map((r) => r.raw_r2_key))
  if (meta.changes > 0) {
    await db
      .prepare(
        `INSERT INTO ingest_counters (day, messages, bytes, deleted) VALUES (?, 0, 0, ?)
         ON CONFLICT (day) DO UPDATE SET deleted = deleted + excluded.deleted`,
      )
      .bind(utcDay(now), meta.changes)
      .run()
  }
  const done = meta.changes < limit
  return { deleted: meta.changes, done, budgetExhausted: !done && remaining - meta.changes <= 0 }
}
