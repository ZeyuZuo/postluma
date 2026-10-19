/**
 * Guards the D1 read budget: listings must walk the user's own messages through an index, even
 * after ANALYZE gives SQLite statistics that tempt it to scan every mailbox instead.
 */
import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildListQuery } from '../worker/repo/messages'
import { addDomain, addMailboxRow, createUser } from './helpers'

let aliceId: string
let aliceBox: string

async function plan(sql: string, params: unknown[]): Promise<string> {
  const { results } = await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).bind(...params).all<{ detail: string }>()
  return results.map((r) => r.detail).join(' | ')
}

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  aliceId = await createUser('alice')
  const bobId = await createUser('bob')
  const boxes = [] as string[]
  for (let i = 0; i < 10; i++) boxes.push(await addMailboxRow(aliceId, domainId, `a${i}@mail.test`))
  for (let i = 0; i < 10; i++) boxes.push(await addMailboxRow(bobId, domainId, `b${i}@mail.test`))
  aliceBox = boxes[0]!
  const statements = []
  for (let i = 0; i < 1200; i++) {
    const box = boxes[i % boxes.length]!
    const owner = i % boxes.length < 10 ? aliceId : bobId
    statements.push(
      env.DB.prepare(
        `INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, is_read, received_at)
         VALUES (?, ?, ?, 'x@example.org', 'x@mail.test', 1, ?, ?)`,
      ).bind(`m${i}`, box, owner, i % 3 === 0 ? 0 : 1, 1_000_000 + i),
    )
  }
  for (let i = 0; i < statements.length; i += 200) await env.DB.batch(statements.slice(i, i + 200))
  await env.DB.exec('ANALYZE')
})

describe('message listing query plans (after ANALYZE)', () => {
  const variants = {
    'global inbox': {},
    'one mailbox': { mailboxId: 'MAILBOX' },
    'next page': { cursor: btoa('1000500:m500') },
    'since poll': { since: 1_000_900 },
    'unread only': { unreadOnly: true },
  }
  for (const [name, extra] of Object.entries(variants)) {
    it(`${name}: messages first, through an index, no full scans`, async () => {
      const opts = { limit: 50, ...extra, ...('mailboxId' in extra ? { mailboxId: aliceBox } : {}) }
      const { sql, params } = buildListQuery(aliceId, opts)
      const detail = await plan(sql, params)
      expect(detail, detail).toMatch(/^SEARCH g USING (COVERING )?INDEX/)
      expect(detail, detail).not.toMatch(/SCAN m\b|SCAN g\b|MULTI-INDEX OR/)
    })
  }
})
