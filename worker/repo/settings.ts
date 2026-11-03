/**
 * Runtime overrides set by an admin. Absent rows mean "use the deploy-time default from
 * `wrangler.jsonc#vars`" (see worker/lib/config.ts), so seed nothing here.
 */
import type { AdminSettings } from '../../shared/api'
import type { AppConfig } from '../lib/config'

/** Admin overrides of deploy-time integer limits that SQL reads directly (see settingIntSql). */
type IntOverrideKey = 'default_mailbox_quota' | 'retention_days' | 'catch_all_max_per_day' | 'catch_all_max_per_address_per_hour'

export type SettingKey = IntOverrideKey | 'registration_open' | 'sending_enabled' | 'admin_bootstrapped'

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

/** Never in personal mode, which has only the administrator; otherwise the admin override or the var. */
export async function isRegistrationOpen(db: D1Database, config: AppConfig): Promise<boolean> {
  if (config.mode === 'personal') return false
  const value = await getSetting(db, 'registration_open')
  return value === null ? config.registrationOpen : value === 'true'
}

/**
 * The service-wide sending switch: admin override, else the SENDING_ENABLED var (default off).
 * Temporary mode has no sending at all, whatever the switch says.
 */
export async function isSendingEnabled(db: D1Database, config: AppConfig): Promise<boolean> {
  if (config.mode === 'temporary') return false
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

/**
 * SQL expression for an integer limit: the admin override if one is stored, else the deploy-time
 * default bound at `defaultParam`. Lets a conditional INSERT apply overrides without a round trip.
 */
export function settingIntSql(key: IntOverrideKey, defaultParam: string): string {
  return `COALESCE(CAST((SELECT value FROM settings WHERE key = '${key}') AS INTEGER), ${defaultParam})`
}

/** An admin override write, or its removal (`null`) so the deploy-time default applies again. */
export function overrideStatement(
  db: D1Database,
  key: IntOverrideKey | 'registration_open' | 'sending_enabled',
  value: string | null,
): D1PreparedStatement {
  if (value === null) return db.prepare('DELETE FROM settings WHERE key = ?').bind(key)
  return db
    .prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, value, Date.now())
}

export async function getAdminSettings(db: D1Database, config: AppConfig): Promise<AdminSettings> {
  const { results } = await db
    .prepare(
      `SELECT key, value FROM settings WHERE key IN ('registration_open', 'default_mailbox_quota', 'retention_days',
         'catch_all_max_per_day', 'catch_all_max_per_address_per_hour')`,
    )
    .all<{ key: string; value: string }>()
  const raw = new Map(results.map((r) => [r.key, r.value]))
  /** A stored non-negative integer override, or null when there is none. */
  const intOverride = (key: IntOverrideKey): number | null => {
    const value = Number(raw.get(key))
    return raw.has(key) && Number.isInteger(value) && value >= 0 ? value : null
  }
  const quota = intOverride('default_mailbox_quota')
  const retention = intOverride('retention_days')
  const perDay = intOverride('catch_all_max_per_day')
  const perAddress = intOverride('catch_all_max_per_address_per_hour')
  return {
    maxRetentionDays: config.maxRetentionDays,
    registrationOpen: raw.has('registration_open') ? raw.get('registration_open') === 'true' : config.registrationOpen,
    defaultMailboxQuota: quota ?? config.defaultMailboxQuota,
    retentionDays: retention ?? config.retentionDays,
    catchAllMaxPerDay: perDay ?? config.ingest.catchAllPerDay,
    catchAllMaxPerAddressPerHour: perAddress ?? config.ingest.catchAllPerAddressPerHour,
    overridden: {
      registrationOpen: raw.has('registration_open'),
      defaultMailboxQuota: quota !== null,
      retentionDays: retention !== null,
      catchAllMaxPerDay: perDay !== null,
      catchAllMaxPerAddressPerHour: perAddress !== null,
    },
    defaults: {
      registrationOpen: config.registrationOpen,
      defaultMailboxQuota: config.defaultMailboxQuota,
      retentionDays: config.retentionDays,
      catchAllMaxPerDay: config.ingest.catchAllPerDay,
      catchAllMaxPerAddressPerHour: config.ingest.catchAllPerAddressPerHour,
    },
  }
}
