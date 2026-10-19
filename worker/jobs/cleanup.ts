import { getConfig } from '../lib/config'
import { utcDay } from '../repo/ingest'
import { getRetentionDays } from '../repo/settings'

const DAY_MS = 24 * 60 * 60 * 1000
/** Deletes run in chunks so one statement never touches too many rows. */
const BATCH = 500
/** 20 × 500 = 10k messages per run, double the default daily intake cap. */
const MAX_BATCHES = 20
const COUNTER_KEEP_DAYS = 7

export interface CleanupResult {
  retentionDays: number
  messagesDeleted: number
  sessionsDeleted: number
}

/** Daily maintenance (cron in wrangler.jsonc): retention, expired sessions, old ingest counters. */
export async function runCleanup(env: Env, now = Date.now()): Promise<CleanupResult> {
  const retentionDays = await getRetentionDays(env.DB, getConfig(env))
  let messagesDeleted = 0
  if (retentionDays > 0) {
    const cutoff = now - retentionDays * DAY_MS
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { meta } = await env.DB.prepare(
        'DELETE FROM messages WHERE id IN (SELECT id FROM messages WHERE received_at < ? ORDER BY received_at LIMIT ?)',
      )
        .bind(cutoff, BATCH)
        .run()
      messagesDeleted += meta.changes
      if (meta.changes < BATCH) break
    }
  }
  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run()
  await env.DB.prepare('DELETE FROM ingest_counters WHERE day < ?').bind(utcDay(now - COUNTER_KEEP_DAYS * DAY_MS)).run()
  const result = { retentionDays, messagesDeleted, sessionsDeleted: sessions.meta.changes }
  console.info('cleanup', result)
  return result
}
