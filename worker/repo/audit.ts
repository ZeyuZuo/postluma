import { newId } from '../lib/crypto'

export type AuditAction =
  | 'user.register'
  | 'auth.login_failed'
  | 'auth.password_changed'
  | 'auth.password_change_failed'
  | 'admin.bootstrap'
  | 'admin.domain_create'
  | 'admin.domain_update'
  | 'admin.domain_delete'

export async function writeAudit(
  db: D1Database,
  entry: { actorId: string | null; action: AuditAction; targetId?: string; detail?: unknown; ip?: string },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO audit_logs (id, actor_id, action, target_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      newId(),
      entry.actorId,
      entry.action,
      entry.targetId ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      entry.ip ?? null,
      Date.now(),
    )
    .run()
}
