import { getConfig } from './lib/config'
import { newId } from './lib/crypto'
import { hashPassword } from './lib/password'
import { writeAudit } from './repo/audit'
import { getSetting } from './repo/settings'

export const INITIAL_ADMIN_USERNAME = 'admin'

/**
 * Creates the initial `admin` account from ADMIN_INITIAL_PASSWORD exactly once per database.
 * The `admin_bootstrapped` setting is written in the same batch, so the bootstrap can never re-run
 * later (e.g. after the admin is demoted or deleted) and resurrect the initial password.
 * Invoked lazily when someone tries to log in as `admin`.
 */
export async function ensureInitialAdmin(env: Env): Promise<void> {
  if ((await getSetting(env.DB, 'admin_bootstrapped')) !== null) return
  if (!env.ADMIN_INITIAL_PASSWORD) {
    console.warn('Initial admin not created: ADMIN_INITIAL_PASSWORD is not set')
    return
  }
  const id = newId()
  const now = Date.now()
  const hash = await hashPassword(env.ADMIN_INITIAL_PASSWORD, getConfig(env).passwordIterations)
  const [, flag] = await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO users (id, username, password_hash, role, status, created_at, updated_at)
       SELECT ?, ?, ?, 'admin', 'active', ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'admin_bootstrapped')`,
    ).bind(id, INITIAL_ADMIN_USERNAME, hash, now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('admin_bootstrapped', ?, ?)",
    ).bind(String(now), now),
  ])
  if (flag?.meta.changes) await writeAudit(env.DB, { actorId: id, action: 'admin.bootstrap', targetId: id })
}
