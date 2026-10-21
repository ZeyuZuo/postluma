/**
 * Runtime overrides set by an admin. Absent rows mean "use the deploy-time default from
 * `wrangler.jsonc#vars`" (see worker/lib/config.ts), so seed nothing here.
 */
import type { AdminSettings } from '../../shared/api'
import type { AppConfig } from '../lib/config'

export type SettingKey = 'default_mailbox_quota' | 'retention_days' | 'registration_open' | 'sending_enabled' | 'admin_bootstrapped'

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function isRegistrationOpen(db: D1Database, config: AppConfig): Promise<boolean> {
  const value = await getSetting(db, 'registration_open')
  return value === null ? config.registrationOpen : value === 'true'
}

/** The service-wide sending switch: admin override, else the SENDING_ENABLED var (default off). */
export async function isSendingEnabled(db: D1Database, config: AppConfig): Promise<boolean> {
  const value = await getSetting(db, 'sending_enabled')
  return value === null ? config.sending.enabled : value === 'true'
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

/** An admin override write, or its removal (`null`) so the deploy-time default applies again. */
export function overrideStatement(
  db: D1Database,
  key: 'default_mailbox_quota' | 'retention_days' | 'registration_open' | 'sending_enabled',
  value: string | null,
): D1PreparedStatement {
  if (value === null) return db.prepare('DELETE FROM settings WHERE key = ?').bind(key)
  return db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, Date.now())
}

export async function getAdminSettings(db: D1Database, config: AppConfig): Promise<AdminSettings> {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('registration_open', 'default_mailbox_quota', 'retention_days')")
    .all<{ key: string; value: string }>()
  const raw = new Map(results.map((r) => [r.key, r.value]))
  const quota = Number(raw.get('default_mailbox_quota'))
  const retention = Number(raw.get('retention_days'))
  const quotaSet = raw.has('default_mailbox_quota') && Number.isInteger(quota) && quota >= 0
  const retentionSet = raw.has('retention_days') && Number.isInteger(retention) && retention >= 0
  return {
    maxRetentionDays: config.maxRetentionDays,
    registrationOpen: raw.has('registration_open') ? raw.get('registration_open') === 'true' : config.registrationOpen,
    defaultMailboxQuota: quotaSet ? quota : config.defaultMailboxQuota,
    retentionDays: retentionSet ? retention : config.retentionDays,
    overridden: { registrationOpen: raw.has('registration_open'), defaultMailboxQuota: quotaSet, retentionDays: retentionSet },
    defaults: {
      registrationOpen: config.registrationOpen,
      defaultMailboxQuota: config.defaultMailboxQuota,
      retentionDays: config.retentionDays,
    },
  }
}
