import { getConfig, mailBucket } from '../lib/config'
import { utcDay } from '../repo/ingest'
import { deleteBatch } from '../repo/maintenance'
import { getRetentionDays } from '../repo/settings'

const DAY_MS = 24 * 60 * 60 * 1000
/** Upper bound on loop iterations; the daily deletion budget is the real limit. */
const MAX_BATCHES = 40
const COUNTER_KEEP_DAYS = 7
const AUDIT_KEEP_DAYS = 90
/** Sent mail is capped at SEND_MAX_PER_DAY (100 by default), so one bounded delete per run keeps up. */
const SENT_BATCH = 2_000

export interface CleanupResult {
  retentionDays: number
  messagesDeleted: number
  sentDeleted: number
  sessionsDeleted: number
}

/** Daily maintenance (cron in wrangler.jsonc): retention, expired sessions, old ingest counters. */
export async function runCleanup(env: Env, now = Date.now()): Promise<CleanupResult> {
  const config = getConfig(env)
  const retentionDays = await getRetentionDays(env.DB, config)
  let messagesDeleted = 0
  if (retentionDays > 0) {
    const scope = { kind: 'olderThan', cutoff: now - retentionDays * DAY_MS } as const
    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = await deleteBatch(env.DB, mailBucket(env), scope, config.maxDeletesPerDay, now)
      messagesDeleted += batch.deleted
      if (batch.done || batch.budgetExhausted) break
    }
  }
  // Sent mail follows the same retention (Phase 9); it has no R2 objects and few rows.
  const sent =
    retentionDays > 0
      ? await env.DB.prepare(
          'DELETE FROM sent_messages WHERE id IN (SELECT id FROM sent_messages WHERE created_at < ? LIMIT ?)',
        )
          .bind(now - retentionDays * DAY_MS, SENT_BATCH)
          .run()
      : null
  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run()
  await env.DB.prepare('DELETE FROM ingest_counters WHERE day < ?').bind(utcDay(now - COUNTER_KEEP_DAYS * DAY_MS)).run()
  await env.DB.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(now - AUDIT_KEEP_DAYS * DAY_MS).run()
  const result = { retentionDays, messagesDeleted, sentDeleted: sent?.meta.changes ?? 0, sessionsDeleted: sessions.meta.changes }
  console.info('cleanup', result)
  return result
}

/** One budgeted batch of "delete mail older than N days" for the admin panel. Never reads content. */
export async function deleteOlderThan(env: Env, days: number, now = Date.now()) {
  return deleteBatch(env.DB, mailBucket(env), { kind: 'olderThan', cutoff: now - days * DAY_MS }, getConfig(env).maxDeletesPerDay, now)
}
