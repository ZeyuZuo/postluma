export type SettingKey = 'default_mailbox_quota' | 'retention_days' | 'registration_open' | 'admin_bootstrapped'

export async function getSetting(db: D1Database, key: SettingKey): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>()
  return row?.value ?? null
}

export async function getBoolSetting(db: D1Database, key: SettingKey): Promise<boolean> {
  return (await getSetting(db, key)) === 'true'
}
