import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import { MARK_READ_BATCH, SEARCH_WINDOW, UNREAD_COUNT_CAP, type InboxSummary, type MessageDetail, type MessageListResponse } from '../shared/api'
import { addDomain, addMailboxRow, addMessageRow, api, createUser, json, login } from './helpers'

let cookie: string
let boxA: string
let boxB: string
let offBox: string

async function list(query = ''): Promise<MessageListResponse> {
  const res = await api(`/api/messages${query}`, { cookie })
  expect(res.status, query).toBe(200)
  return json<MessageListResponse>(res)
}

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  const userId = await createUser('alice')
  boxA = await addMailboxRow(userId, domainId, 'a@mail.test')
  boxB = await addMailboxRow(userId, domainId, 'b@mail.test')
  offBox = await addMailboxRow(userId, domainId, 'off@mail.test', 'disabled')
  cookie = await login('alice')
})

describe('listing messages', () => {
  it('shows the global inbox newest first, excluding disabled mailboxes', async () => {
    await env.DB.prepare("UPDATE mailboxes SET note = 'Shop' WHERE id = ?").bind(boxB).run()
    const first = await addMessageRow(boxA, { subject: 'first' })
    const second = await addMessageRow(boxB, { subject: 'second', code: '482913' })
    await addMessageRow(offBox, { subject: 'from a disabled mailbox' })
    const { items } = await list()
    expect(items.map((m) => m.id)).toEqual([second, first])
    expect(items[0]).toMatchObject({
      mailboxAddress: 'b@mail.test',
      mailboxNote: 'Shop',
      mailboxStatus: 'active',
      subject: 'second',
      verificationCode: '482913',
      isRead: false,
    })
    expect(items[1]).toMatchObject({ mailboxNote: null })
    expect(items[0]).not.toHaveProperty('htmlBody')
  })

  it('filters by mailbox, including disabled ones (their history page)', async () => {
    await addMessageRow(boxA)
    const old = await addMessageRow(offBox, { subject: 'kept history' })
    expect((await list(`?mailbox=${offBox}`)).items.map((m) => m.id)).toEqual([old])
    expect((await list(`?mailbox=${boxA}`)).items).toHaveLength(1)
  })

  it('searches subject, sender and snippet, treating wildcards literally', async () => {
    await addMessageRow(boxA, { subject: 'GitHub sign-in' })
    await addMessageRow(boxA, { subject: 'Weekly', from: 'news@paper.example' })
    await addMessageRow(boxA, { subject: 'x', snippet: 'Your Steam code' })
    expect((await list('?q=github')).items).toHaveLength(1)
    expect((await list('?q=paper.example')).items).toHaveLength(1)
    expect((await list('?q=steam')).items).toHaveLength(1)
    expect((await list('?q=%25%25')).items).toHaveLength(0)
    expect((await api('/api/messages?q=a', { cookie })).status).toBe(400) // under SEARCH_MIN_CHARS
  })

  it('filters unread and code-only, supports since-polling and cursor pagination', async () => {
    const t0 = Date.UTC(2026, 0, 1)
    for (let i = 0; i < 55; i++) await addMessageRow(boxA, { receivedAt: t0 + i, read: i % 2 === 0, code: i % 5 === 0 ? `10000${i}` : undefined })
    expect((await list('?unread=1&limit=50')).items.every((m) => !m.isRead)).toBe(true)
    expect((await list('?code=1')).items).toHaveLength(11)
    expect((await list(`?since=${t0 + 52}`)).items).toHaveLength(2)
    const page1 = await list()
    expect(page1.items).toHaveLength(50)
    const page2 = await list(`?cursor=${encodeURIComponent(page1.nextCursor!)}`)
    expect(page2.items).toHaveLength(5)
    expect(page2.nextCursor).toBeNull()
    expect((await list('?limit=5')).items).toHaveLength(5)
    expect((await api('/api/messages?limit=500', { cookie })).status).toBe(400)
  })
})

describe('reading and managing messages', () => {
  it('returns full detail without marking it read; PATCH marks read and unread', async () => {
    const id = await addMessageRow(boxA, {
      subject: 'Invoice',
      html: '<p>Hi</p>',
      attachmentsJson: JSON.stringify([{ filename: 'a.pdf', contentType: 'application/pdf', size: 9, contentId: null, inline: false }]),
    })
    const detail = (await json<{ message: MessageDetail }>(await api(`/api/messages/${id}`, { cookie }))).message
    expect(detail).toMatchObject({
      id,
      toAddress: 'a@mail.test',
      envelopeFrom: 'bounce@mailer.example',
      htmlBody: '<p>Hi</p>',
      isRead: false,
      isTruncated: false,
      attachments: [{ filename: 'a.pdf', contentType: 'application/pdf', size: 9, inline: false }],
    })
    expect((await list()).items[0]!.isRead).toBe(false) // GET did not mutate

    expect((await api(`/api/messages/${id}`, { cookie, method: 'PATCH', body: { isRead: true } })).status).toBe(204)
    expect((await list()).items[0]!.isRead).toBe(true)
    await api(`/api/messages/${id}`, { cookie, method: 'PATCH', body: { isRead: false } })
    expect((await list()).items[0]!.isRead).toBe(false)
  })

  it('deletes a message', async () => {
    const id = await addMessageRow(boxA)
    expect((await api(`/api/messages/${id}`, { cookie, method: 'DELETE' })).status).toBe(204)
    expect((await api(`/api/messages/${id}`, { cookie })).status).toBe(404)
  })

  it('marks everything read, globally or per mailbox', async () => {
    await addMessageRow(boxA)
    await addMessageRow(boxB)
    await addMessageRow(offBox)
    const one = await api('/api/messages/mark-read', { cookie, body: { mailboxId: boxA } })
    expect(await json(one)).toEqual({ updated: 1 })
    const all = await api('/api/messages/mark-read', { cookie, body: {} })
    expect(await json(all)).toEqual({ updated: 1 }) // the disabled mailbox is left alone
  })

  it('summarizes unread mail in active mailboxes and the latest arrival', async () => {
    await addMessageRow(boxA)
    await addMessageRow(boxB, { read: true })
    const latest = await addMessageRow(offBox)
    const summary = await json<InboxSummary>(await api('/api/messages/summary', { cookie }))
    const latestAt = (await env.DB.prepare('SELECT received_at FROM messages WHERE id = ?').bind(latest).first<{ received_at: number }>())!.received_at
    expect(summary).toEqual({ unread: 1, latestReceivedAt: latestAt })
  })
})

async function bulkMessages(mailboxId: string, count: number, fields: { read?: boolean; subject?: (i: number) => string } = {}) {
  const box = (await env.DB.prepare('SELECT user_id, address FROM mailboxes WHERE id = ?').bind(mailboxId).first<{ user_id: string; address: string }>())!
  const t0 = Date.UTC(2026, 5, 1)
  for (let start = 0; start < count; start += 200) {
    const statements = []
    for (let i = start; i < Math.min(count, start + 200); i++) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO messages (id, mailbox_id, user_id, from_address, to_address, subject, size, is_read, received_at)
           VALUES (?, ?, ?, 'x@example.org', ?, ?, 1, ?, ?)`,
        ).bind(`${mailboxId}-${i}`, mailboxId, box.user_id, box.address, fields.subject?.(i) ?? 'bulk', fields.read ? 1 : 0, t0 + i),
      )
    }
    await env.DB.batch(statements)
  }
}

describe('bounded-cost behaviour (D1 budget)', () => {
  it('caps the unread count and skips the count when nothing new arrived', async () => {
    await bulkMessages(boxA, UNREAD_COUNT_CAP + 20)
    const full = await json<InboxSummary>(await api('/api/messages/summary', { cookie }))
    expect(full.unread).toBe(UNREAD_COUNT_CAP)
    const unchanged = await json<InboxSummary>(await api(`/api/messages/summary?known=${full.latestReceivedAt}`, { cookie }))
    expect(unchanged).toEqual({ unread: null, latestReceivedAt: full.latestReceivedAt })
    const recount = await json<InboxSummary>(await api(`/api/messages/summary?known=${full.latestReceivedAt}&recount=1`, { cookie }))
    expect(recount.unread).toBe(UNREAD_COUNT_CAP)
    const stale = await json<InboxSummary>(await api('/api/messages/summary?known=1', { cookie }))
    expect(stale.unread).toBe(UNREAD_COUNT_CAP)
  })

  it('marks at most one batch read per call', async () => {
    await bulkMessages(boxA, MARK_READ_BATCH + 30)
    expect(await json(await api('/api/messages/mark-read', { cookie, body: {} }))).toEqual({ updated: MARK_READ_BATCH })
    expect(await json(await api('/api/messages/mark-read', { cookie, body: {} }))).toEqual({ updated: 30 })
  })

  it('searches only the newest SEARCH_WINDOW messages', async () => {
    await bulkMessages(boxA, SEARCH_WINDOW + 1, { subject: (i) => (i === 0 ? 'needle-old' : i === SEARCH_WINDOW ? 'needle-new' : 'hay') })
    const { items } = await list('?q=needle')
    expect(items.map((m) => m.subject)).toEqual(['needle-new'])
  })
})
