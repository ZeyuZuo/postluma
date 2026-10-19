import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { runCleanup } from '../worker/jobs/cleanup'
import { addDomain, createUser, setSetting } from './helpers'

const DAY = 24 * 3600 * 1000
const NOW = Date.UTC(2026, 9, 19, 3, 17)
let mailboxId: string
let userId: string

async function addMessage(ageDays: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at)
     VALUES (?, ?, ?, 'a@example.org', 'box@mail.test', 1, ?)`,
  )
    .bind(crypto.randomUUID(), mailboxId, userId, NOW - ageDays * DAY)
    .run()
}

const count = async (table: string) =>
  (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  userId = await createUser('alice')
  mailboxId = crypto.randomUUID()
  await env.DB.prepare(
    "INSERT INTO mailboxes (id, user_id, domain_id, address, status, created_at, updated_at) VALUES (?, ?, ?, 'box@mail.test', 'active', 1, 1)",
  )
    .bind(mailboxId, userId, domainId)
    .run()
})

describe('daily cleanup', () => {
  it('deletes mail older than MESSAGE_RETENTION_DAYS (default 30) and keeps the rest', async () => {
    for (const age of [1, 29, 31, 400]) await addMessage(age)
    const result = await runCleanup(env, NOW)
    expect(result).toMatchObject({ retentionDays: 30, messagesDeleted: 2 })
    expect(await count('messages')).toBe(2)
  })

  it('lets an admin override the retention, including 0 = keep forever', async () => {
    for (const age of [1, 10, 400]) await addMessage(age)
    await setSetting('retention_days', '0')
    expect((await runCleanup(env, NOW)).messagesDeleted).toBe(0)
    await setSetting('retention_days', '5')
    expect((await runCleanup(env, NOW)).messagesDeleted).toBe(2)
  })

  it('works through large backlogs in batches', async () => {
    const statements = Array.from({ length: 1200 }, (_, i) =>
      env.DB.prepare(
        `INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, size, received_at)
         VALUES (?, ?, ?, 'a@example.org', 'box@mail.test', 1, ?)`,
      ).bind(`old-${i}`, mailboxId, userId, NOW - 90 * DAY - i),
    )
    await env.DB.batch(statements)
    expect((await runCleanup(env, NOW)).messagesDeleted).toBe(1200)
  })

  it('purges expired sessions and old ingest counters', async () => {
    await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, 0, ?), (?, ?, 0, ?)')
      .bind('expired', userId, NOW - 1, 'live', userId, NOW + DAY)
      .run()
    await env.DB.prepare("INSERT INTO ingest_counters (day, messages, bytes) VALUES ('2026-10-01', 5, 5), ('2026-10-18', 1, 1)").run()
    expect((await runCleanup(env, NOW)).sessionsDeleted).toBe(1)
    expect(await count('sessions')).toBe(1)
    expect((await env.DB.prepare('SELECT day FROM ingest_counters').all()).results).toEqual([{ day: '2026-10-18' }])
  })
})
