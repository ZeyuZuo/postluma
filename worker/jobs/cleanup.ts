import { getConfig } from '../lib/config'
import { utcDay } from '../repo/ingest'
import { deleteBatch } from '../repo/maintenance'
import { getRetentionDays } from '../repo/settings'

const DAY_MS = 24 * 60 * 60 * 1000
/** Upper bound on loop iterations; the daily deletion budget is the real limit. */
const MAX_BATCHES = 40
const COUNTER_KEEP_DAYS = 7
const AUDIT_KEEP_DAYS = 90

export interface CleanupResult {
  retentionDays: number
  messagesDeleted: number
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
      const batch = await deleteBatch(env.DB, scope, config.maxDeletesPerDay, now)
      messagesDeleted += batch.deleted
      if (batch.done || batch.budgetExhausted) break
    }
  }
  const sessions = await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run()
  await env.DB.prepare('DELETE FROM ingest_counters WHERE day < ?').bind(utcDay(now - COUNTER_KEEP_DAYS * DAY_MS)).run()
  await env.DB.prepare('DELETE FROM audit_logs WHERE created_at < ?').bind(now - AUDIT_KEEP_DAYS * DAY_MS).run()
  const result = { retentionDays, messagesDeleted, sessionsDeleted: sessions.meta.changes }
  console.info('cleanup', result)
  return result
}

/** One budgeted batch of "delete mail older than N days" for the admin panel. Never reads content. */
export async function deleteOlderThan(env: Env, days: number, now = Date.now()) {
  return deleteBatch(env.DB, { kind: 'olderThan', cutoff: now - days * DAY_MS }, getConfig(env).maxDeletesPerDay, now)
}
