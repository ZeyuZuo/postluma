import type { AdminDomain, PublicDomain } from '../../shared/api'
import { newId } from '../lib/crypto'
import { ApiError } from '../lib/errors'
import { isUniqueViolation } from './users'

interface DomainRow {
  id: string
  domain: string
  enabled: number
  created_at: number
  mailbox_count: number
}

export async function listEnabledDomains(db: D1Database): Promise<PublicDomain[]> {
  const { results } = await db
    .prepare('SELECT id, domain FROM domains WHERE enabled = 1 ORDER BY domain')
    .all<PublicDomain>()
  return results
}

export async function findEnabledDomain(db: D1Database, id: string): Promise<PublicDomain | null> {
  return db.prepare('SELECT id, domain FROM domains WHERE id = ? AND enabled = 1').bind(id).first<PublicDomain>()
}

export async function findDomainName(db: D1Database, id: string): Promise<string> {
  const row = await db.prepare('SELECT domain FROM domains WHERE id = ?').bind(id).first<{ domain: string }>()
  if (!row) throw new ApiError(404, 'not_found')
  return row.domain
}

export async function listAllDomains(db: D1Database): Promise<AdminDomain[]> {
  const { results } = await db
    .prepare(
      `SELECT d.id, d.domain, d.enabled, d.created_at,
              (SELECT COUNT(*) FROM mailboxes m WHERE m.domain_id = d.id) AS mailbox_count
       FROM domains d ORDER BY d.domain`,
    )
    .all<DomainRow>()
  return results.map((r) => ({
    id: r.id,
    domain: r.domain,
    enabled: r.enabled === 1,
    mailboxCount: r.mailbox_count,
    createdAt: r.created_at,
  }))
}

export async function createDomain(db: D1Database, domain: string): Promise<string> {
  const id = newId()
  try {
    await db
      .prepare('INSERT INTO domains (id, domain, enabled, created_at) VALUES (?, ?, 1, ?)')
      .bind(id, domain, Date.now())
      .run()
  } catch (err) {
    if (isUniqueViolation(err)) throw new ApiError(409, 'domain_exists')
    throw err
  }
  return id
}

/** Returns the domain name (for the audit log). */
export async function setDomainEnabled(db: D1Database, id: string, enabled: boolean): Promise<string> {
  const row = await db
    .prepare('UPDATE domains SET enabled = ? WHERE id = ? RETURNING domain')
    .bind(enabled ? 1 : 0, id)
    .first<{ domain: string }>()
  if (!row) throw new ApiError(404, 'not_found')
  return row.domain
}

/** Only domains that never had a mailbox can be deleted (addresses must stay unique forever). */
export async function deleteUnusedDomain(db: D1Database, id: string): Promise<string> {
  const deleted = await db
    .prepare(
      `DELETE FROM domains WHERE id = ?1
         AND NOT EXISTS (SELECT 1 FROM mailboxes WHERE domain_id = ?1)
         AND NOT EXISTS (SELECT 1 FROM retired_addresses r JOIN domains d ON d.id = ?1
                         WHERE r.address LIKE '%@' || d.domain)
       RETURNING domain`,
    )
    .bind(id)
    .first<{ domain: string }>()
  if (deleted) return deleted.domain
  const exists = await db.prepare('SELECT 1 AS found FROM domains WHERE id = ?').bind(id).first()
  throw exists ? new ApiError(409, 'domain_in_use') : new ApiError(404, 'not_found')
}
