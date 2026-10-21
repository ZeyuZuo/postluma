import type { AuditListResponse } from '../../shared/api'
import { newId } from '../lib/crypto'
import { ApiError } from '../lib/errors'

export type AuditAction =
  | 'user.register'
  | 'auth.login_failed'
  | 'auth.password_changed'
  | 'auth.password_change_failed'
  | 'admin.bootstrap'
  | 'admin.domain_create'
  | 'admin.domain_update'
  | 'admin.domain_delete'
  | 'admin.user_approve'
  | 'admin.user_reject'
  | 'admin.user_ban'
  | 'admin.user_unban'
  | 'admin.user_quota'
  | 'admin.user_purge_messages'
  | 'admin.user_delete'
  | 'admin.settings_update'
  | 'admin.cleanup'
  | 'mail.send'

export interface AuditInput {
  actorId: string | null
  action: AuditAction
  targetId?: string
  detail?: unknown
  ip?: string
}

/** For batching the audit row with the change it records (both or neither). */
export function auditStatement(db: D1Database, entry: AuditInput): D1PreparedStatement {
  return db
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
}

export async function writeAudit(db: D1Database, entry: AuditInput): Promise<void> {
  await auditStatement(db, entry).run()
}

const AUDIT_PAGE = 50

export async function listAudit(db: D1Database, cursor?: string): Promise<AuditListResponse> {
  const params: unknown[] = []
  let where = ''
  if (cursor) {
    const [createdAt, id] = (() => {
      try {
        const [a, b] = atob(cursor).split(':')
        if (Number.isSafeInteger(Number(a)) && b) return [Number(a), b] as const
      } catch {
        // fall through
      }
      throw new ApiError(400, 'invalid_input')
    })()
    where = 'WHERE (a.created_at, a.id) < (?, ?)'
    params.push(createdAt, id)
  }
  const { results } = await db
    .prepare(
      `SELECT a.id, a.action, u.username, t.username AS target_username, a.target_id, a.detail, a.ip, a.created_at
       FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN users t ON t.id = a.target_id ${where}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    )
    .bind(...params, AUDIT_PAGE + 1)
    .all<{ id: string; action: string; username: string | null; target_username: string | null; target_id: string | null; detail: string | null; ip: string | null; created_at: number }>()
  const page = results.slice(0, AUDIT_PAGE)
  const last = page.at(-1)
  return {
    items: page.map((r) => {
      let detail: unknown = null
      try {
        detail = r.detail ? JSON.parse(r.detail) : null
      } catch {
        detail = r.detail
      }
      return { id: r.id, action: r.action, actorUsername: r.username, targetId: r.target_id, targetUsername: r.target_username, detail, ip: r.ip, createdAt: r.created_at }
    }),
    nextCursor: results.length > AUDIT_PAGE && last ? btoa(`${last.created_at}:${last.id}`) : null,
  }
}
