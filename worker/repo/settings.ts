/**
 * Runtime overrides set by an admin. Absent rows mean "use the deploy-time default from
 * `wrangler.jsonc#vars`" (see worker/lib/config.ts), so seed nothing here.
 */
import type { AppConfig } from '../lib/config'

export type SettingKey = 'default_mailbox_quota' | 'retention_days' | 'registration_open' | 'admin_bootstrapped'

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function isRegistrationOpen(db: D1Database, config: AppConfig): Promise<boolean> {
  const value = await getSetting(db, 'registration_open')
  return value === null ? config.registrationOpen : value === 'true'
}

export async function getRetentionDays(db: D1Database, config: AppConfig): Promise<number> {
  const raw = await getSetting(db, 'retention_days')
  const value = Number(raw)
  return raw !== null && Number.isInteger(value) && value >= 0 ? value : config.retentionDays
}

/**
 * SQL expression for user `userExpr`'s effective active-mailbox quota: per-user override, then the
 * admin's global override, then the deploy-time default bound at `defaultParam`.
 */
export function effectiveQuotaSql(userExpr: string, defaultParam: string): string {
  return `(SELECT COALESCE(u.mailbox_quota,
            CAST((SELECT value FROM settings WHERE key = 'default_mailbox_quota') AS INTEGER), ${defaultParam})
          FROM users u WHERE u.id = ${userExpr})`
}
