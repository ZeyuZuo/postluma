import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MailboxListResponse } from '../shared/api'
import {
  PARSE_WINDOW_BYTES,
  REJECT_FLOODED,
  REJECT_MALFORMED,
  REJECT_OVER_BUDGET,
  REJECT_UNAVAILABLE,
  handleEmail,
} from '../worker/email'
import { utcDay } from '../worker/repo/ingest'
import { addDomain, api, createUser, emailStub, json, login, mime } from './helpers'

let domainId: string
let aliceId: string

async function addMailbox(userId: string, address: string, status = 'active'): Promise<string> {
  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO mailboxes (id, user_id, domain_id, address, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)',
  )
    .bind(id, userId, domainId, address, status)
    .run()
  return id
}

async function deliver(raw: string, to: string, extra: { from?: string; rawSize?: number } = {}) {
  const stub = emailStub(raw, { to, ...extra })
  await handleEmail(stub, env, createExecutionContext())
  return stub
}

async function messageRows() {
  return (await env.DB.prepare('SELECT * FROM messages ORDER BY received_at').all<Record<string, unknown>>()).results
}

async function setSetting(key: string, value: string): Promise<void> {
  await env.DB.prepare('UPDATE settings SET value = ? WHERE key = ?').bind(value, key).run()
}

beforeEach(async () => {
  domainId = await addDomain('mail.test')
  aliceId = await createUser('alice')
})

describe('accepting mail', () => {
  it('stores mail for an active mailbox of an active user, with code, snippet and envelope sender', async () => {
    const mailboxId = await addMailbox(aliceId, 'alice-box@mail.test')
    const stub = await deliver(
      mime({ from: '"GitHub" <noreply@github.example>', subject: 'Your sign-in code', text: 'Your verification code is 482913.\nIt expires soon.' }),
      'alice-box@mail.test',
      { from: 'bounce-123@mailer.example' },
    )
    expect(stub.rejected).toBeNull()
    const [row] = await messageRows()
    expect(row).toMatchObject({
      mailbox_id: mailboxId,
      user_id: aliceId,
      to_address: 'alice-box@mail.test',
      envelope_from: 'bounce-123@mailer.example',
      from_address: 'noreply@github.example',
      from_name: 'GitHub',
      subject: 'Your sign-in code',
      verification_code: '482913',
      snippet: 'Your verification code is 482913. It expires soon.',
      is_read: 0,
      has_attachments: 0,
      is_truncated: 0,
    })
    const list = await json<MailboxListResponse>(await api('/api/mailboxes', { cookie: await login('alice') }))
    expect(list.items[0]).toMatchObject({ messageCount: 1, unreadCount: 1, lastReceivedAt: row!.received_at })
    const counter = await env.DB.prepare('SELECT messages, bytes FROM ingest_counters WHERE day = ?')
      .bind(utcDay(Date.now()))
      .first<{ messages: number; bytes: number }>()
    expect(counter?.messages).toBe(1)
    expect(counter?.bytes).toBeGreaterThan(0)
  })

  it('matches the envelope recipient case-insensitively', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    expect((await deliver(mime({}), ' Alice-Box@MAIL.Test ')).rejected).toBeNull()
    expect(await messageRows()).toHaveLength(1)
  })

  it('keeps delivering to existing addresses after their domain is disabled', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await env.DB.prepare('UPDATE domains SET enabled = 0 WHERE id = ?').bind(domainId).run()
    expect((await deliver(mime({}), 'alice-box@mail.test')).rejected).toBeNull()
  })

  it('derives text and the code from HTML-only mail without flagging it truncated', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const filler = `<p>${'x'.repeat(100_000)}</p>`
    await deliver(mime({ subject: 'Sign in', html: `<p>Your code is <b>918273</b></p><script>x()</script>${filler}` }), 'alice-box@mail.test')
    const [row] = await messageRows()
    expect(row).toMatchObject({ verification_code: '918273', text_body: null, is_truncated: 0 })
    expect(row!.snippet).toMatch(/^Your code is 918273/)
    expect(row!.html_body).toContain('<script>') // stored raw; sanitized only when rendered (Phase 4)
  })

  it('parses only the first window of a huge message and flags it truncated', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const html = `<p>验证码 552901</p>${'<p>验证码</p>'.repeat(60_000)}`
    const stub = await deliver(mime({ html }), 'alice-box@mail.test')
    expect(stub.rejected).toBeNull()
    expect(stub.rawSize).toBeGreaterThan(PARSE_WINDOW_BYTES)
    const [row] = await messageRows()
    expect(row).toMatchObject({ is_truncated: 1, verification_code: '552901' })
    expect(new TextEncoder().encode(row!.html_body as string).byteLength).toBeLessThanOrEqual(PARSE_WINDOW_BYTES)
  })

  it('records attachment metadata as JSON, ignoring inline images for the paperclip flag', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const multipart = (parts: string[]) =>
      [
        'From: a@example.org',
        'To: alice-box@mail.test',
        'Subject: Invoice',
        'Message-ID: <inv@example.org>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="b1"',
        '',
        '--b1',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'See attached.',
        ...parts,
        '--b1--',
      ].join('\n')
    const pdf = ['--b1', 'Content-Type: application/pdf; name="invoice.pdf"', 'Content-Disposition: attachment; filename="invoice‮gpj.pdf"', 'Content-Transfer-Encoding: base64', '', btoa('%PDF-1.4 fake')]
    const logo = ['--b1', 'Content-Type: image/png', 'Content-Disposition: inline', 'Content-ID: <logo@x>', 'Content-Transfer-Encoding: base64', '', btoa('png')]

    await deliver(multipart(logo), 'alice-box@mail.test')
    await deliver(multipart([...pdf, ...logo]), 'alice-box@mail.test')
    const [inlineOnly, withPdf] = await messageRows()
    expect(inlineOnly!.has_attachments).toBe(0)
    expect(withPdf!.has_attachments).toBe(1)
    expect(JSON.parse(withPdf!.attachments_json as string)).toEqual([
      { filename: 'invoicegpj.pdf', contentType: 'application/pdf', size: 13, contentId: null, inline: false },
      { filename: null, contentType: 'image/png', size: 3, contentId: '<logo@x>', inline: true },
    ])
    const stored = await env.DB.prepare('SELECT COUNT(*) AS n FROM attachments').first<{ n: number }>()
    expect(stored?.n).toBe(0) // content/rows only once R2 is enabled
  })

  it('strips bidi-override and control characters from the subject and sender name', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await deliver(mime({ from: '"Pay‮pal" <x@example.org>', subject: 'Re‮set' }), 'alice-box@mail.test')
    expect((await messageRows())[0]).toMatchObject({ subject: 'Reset', from_name: 'Paypal' })
  })
})

describe('rejecting mail', () => {
  it('rejects unknown, disabled and non-active-owner mailboxes with one identical reason', async () => {
    await addMailbox(aliceId, 'off@mail.test', 'disabled')
    for (const status of ['pending', 'rejected', 'banned']) {
      const userId = await createUser(`u-${status}`, { status: status as 'pending' })
      await addMailbox(userId, `${status}@mail.test`)
    }
    for (const to of ['nobody@mail.test', 'off@mail.test', 'pending@mail.test', 'rejected@mail.test', 'banned@mail.test', 'x@other.test']) {
      expect((await deliver(mime({}), to)).rejected, to).toBe(REJECT_UNAVAILABLE)
    }
    expect(await messageRows()).toHaveLength(0)
  })

  it('rejects subaddresses and Unicode case-folding tricks instead of fuzzy-matching', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await addMailbox(aliceId, 'kate@mail.test')
    expect((await deliver(mime({}), 'alice-box+news@mail.test')).rejected).toBe(REJECT_UNAVAILABLE)
    expect((await deliver(mime({}), 'Kate@mail.test')).rejected).toBe(REJECT_UNAVAILABLE) // KELVIN SIGN
  })

  it('bounces malformed MIME instead of throwing', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const depth = 30
    const lines = ['From: a@example.org', 'To: alice-box@mail.test', 'Subject: nested', 'Message-ID: <n@x>', 'MIME-Version: 1.0']
    for (let i = 0; i < depth; i++) lines.push(`Content-Type: multipart/mixed; boundary="b${i}"`, '', `--b${i}`)
    lines.push('Content-Type: text/plain', '', 'deep')
    const stub = await deliver(lines.join('\n'), 'alice-box@mail.test')
    expect(stub.rejected).toBe(REJECT_MALFORMED)
    expect(await messageRows()).toHaveLength(0)
  })
})

describe('flood protection and ingest budget', () => {
  it('caps messages per mailbox per hour, even for concurrent deliveries', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await setSetting('max_messages_per_mailbox_per_hour', '2')
    const stubs = await Promise.all(Array.from({ length: 6 }, () => deliver(mime({}), 'alice-box@mail.test')))
    expect(stubs.filter((s) => s.rejected === null)).toHaveLength(2)
    expect(stubs.filter((s) => s.rejected === REJECT_FLOODED)).toHaveLength(4)
    expect(await messageRows()).toHaveLength(2)
  })

  it('caps messages per user per hour across all of their mailboxes', async () => {
    await setSetting('max_messages_per_user_per_hour', '3')
    for (const name of ['a', 'b', 'c', 'd']) await addMailbox(aliceId, `${name}@mail.test`)
    const results = []
    for (const name of ['a', 'b', 'c', 'd']) results.push((await deliver(mime({}), `${name}@mail.test`)).rejected)
    expect(results).toEqual([null, null, null, REJECT_FLOODED])
  })

  it('stops all intake once the daily message budget is spent', async () => {
    const bobId = await createUser('bob')
    await addMailbox(aliceId, 'alice-box@mail.test')
    await addMailbox(bobId, 'bob-box@mail.test')
    await setSetting('max_messages_per_day', '2')
    expect((await deliver(mime({}), 'alice-box@mail.test')).rejected).toBeNull()
    expect((await deliver(mime({}), 'bob-box@mail.test')).rejected).toBeNull()
    expect((await deliver(mime({}), 'alice-box@mail.test')).rejected).toBe(REJECT_OVER_BUDGET)
    expect((await deliver(mime({}), 'bob-box@mail.test')).rejected).toBe(REJECT_OVER_BUDGET)
  })

  it('stops intake when the daily byte budget would be exceeded', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await setSetting('max_ingest_bytes_per_day', '20000')
    expect((await deliver(mime({ text: 'a'.repeat(10_000) }), 'alice-box@mail.test')).rejected).toBeNull()
    expect((await deliver(mime({ text: 'b'.repeat(15_000) }), 'alice-box@mail.test')).rejected).toBe(REJECT_OVER_BUDGET)
    expect(await messageRows()).toHaveLength(1)
  })

  it('does not count rejected mail against the budget', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await setSetting('max_messages_per_mailbox_per_hour', '1')
    await deliver(mime({}), 'alice-box@mail.test')
    await deliver(mime({}), 'alice-box@mail.test')
    const counter = await env.DB.prepare('SELECT messages FROM ingest_counters').first<{ messages: number }>()
    expect(counter?.messages).toBe(1)
  })
})
