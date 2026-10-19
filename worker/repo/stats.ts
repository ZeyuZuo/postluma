/**
 * Admin dashboard numbers. Deliberately avoids counting `messages` (a full index walk per view on
 * the D1 read budget): intake comes from the daily ingest counters instead.
 */
import type { AdminStats, UserStatus } from '../../shared/api'
import type { AppConfig } from '../lib/config'
import { utcDay } from './ingest'

const DAY_MS = 24 * 60 * 60 * 1000
const DB_LIMIT_BYTES = 500 * 1024 * 1024 // Workers Free plan: 500 MB per D1 database

export async function getStats(db: D1Database, config: AppConfig, now = Date.now()): Promise<AdminStats> {
  const users = await db.prepare('SELECT status, COUNT(*) AS n FROM users GROUP BY status').all<{ status: UserStatus; n: number }>()
  const mailboxes = await db.prepare('SELECT status, COUNT(*) AS n FROM mailboxes GROUP BY status').all<{ status: string; n: number }>()
  const days = Array.from({ length: 7 }, (_, i) => utcDay(now - (6 - i) * DAY_MS))
  const intake = await db
    .prepare('SELECT day, messages, bytes FROM ingest_counters WHERE day >= ? ORDER BY day')
    .bind(days[0])
    .all<{ day: string; messages: number; bytes: number }>()
  const byDay = new Map(intake.results.map((r) => [r.day, r]))
  const series = days.map((day) => ({ day, messages: byDay.get(day)?.messages ?? 0, bytes: byDay.get(day)?.bytes ?? 0 }))
  const today = series.at(-1)!
  const userCounts: Record<UserStatus, number> = { pending: 0, active: 0, banned: 0, rejected: 0 }
  for (const r of users.results) userCounts[r.status] = r.n
  return {
    users: userCounts,
    mailboxes: {
      active: mailboxes.results.find((r) => r.status === 'active')?.n ?? 0,
      disabled: mailboxes.results.find((r) => r.status === 'disabled')?.n ?? 0,
    },
    intake: series,
    today: {
      messages: today.messages,
      bytes: today.bytes,
      maxMessages: config.ingest.messagesPerDay,
      maxBytes: config.ingest.bytesPerDay,
    },
    database: { bytes: intake.meta.size_after ?? null, limitBytes: DB_LIMIT_BYTES },
  }
}
