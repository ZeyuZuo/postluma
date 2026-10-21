import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MailboxListResponse, MessageListResponse } from '../shared/api'
import {
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

const PARSE_WINDOW_BYTES = 256 * 1024 // wrangler.jsonc INGEST_PARSE_WINDOW_KB

async function deliver(
  raw: string,
  to: string,
  extra: { from?: string; rawSize?: number } = {},
  vars: Partial<Record<keyof Env, string>> = {},
) {
  const stub = emailStub(raw, { to, ...extra })
  await handleEmail(stub, { ...env, ...vars } as Env, createExecutionContext())
  return stub
}

async function messageRows() {
  return (await env.DB.prepare('SELECT * FROM messages ORDER BY received_at').all<Record<string, unknown>>()).results
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

  it('stores a detected verification link and lists it under the codes filter', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const html = '<p>Welcome!</p><a href="https://app.example.com/verify?token=abc&amp;u=1">Verify email</a>'
    await deliver(mime({ subject: 'Confirm your account', html }), 'alice-box@mail.test')
    const [row] = await messageRows()
    expect(row).toMatchObject({ verification_code: null, verification_link: 'https://app.example.com/verify?token=abc&u=1' })
    const res = await api('/api/messages?code=1', { cookie: await login('alice') })
    const { items } = await json<MessageListResponse>(res)
    expect(items.map((m) => m.verificationLink)).toEqual(['https://app.example.com/verify?token=abc&u=1'])
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

  it('rejects subaddresses by default and Unicode case-folding tricks instead of fuzzy-matching', async () => {
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

describe('opt-in subaddressing', () => {
  async function optIn(mailboxId: string, on = true): Promise<void> {
    await env.DB.prepare('UPDATE mailboxes SET accept_subaddress = ? WHERE id = ?').bind(on ? 1 : 0, mailboxId).run()
  }

  it('delivers local+tag@ to local@ once the mailbox opts in, keeping the tagged recipient', async () => {
    const box = await addMailbox(aliceId, 'alice-box@mail.test')
    await optIn(box)
    for (const to of ['alice-box+news@mail.test', 'Alice-Box+Shop@MAIL.test', 'alice-box+@mail.test', 'alice-box+a+b@mail.test']) {
      expect((await deliver(mime({}), to)).rejected, to).toBeNull()
    }
    const rows = (await env.DB.prepare('SELECT mailbox_id, to_address FROM messages ORDER BY to_address').all()).results
    expect(rows.every((r) => r.mailbox_id === box)).toBe(true)
    expect(rows.map((r) => r.to_address)).toEqual([
      'alice-box+@mail.test',
      'alice-box+a+b@mail.test',
      'alice-box+news@mail.test',
      'alice-box+shop@mail.test',
    ])
  })

  it('still rejects an empty base, non-ASCII tags, disabled mailboxes and opted-out ones', async () => {
    const box = await addMailbox(aliceId, 'alice-box@mail.test')
    const off = await addMailbox(aliceId, 'off@mail.test', 'disabled')
    await optIn(box)
    await optIn(off)
    await addMailbox(aliceId, 'plain@mail.test')
    for (const to of ['+news@mail.test', 'alice-box+caf\u00e9@mail.test', 'off+news@mail.test', 'plain+news@mail.test', 'alice-box+x@other.test']) {
      expect((await deliver(mime({}), to)).rejected, to).toBe(REJECT_UNAVAILABLE)
    }
    await optIn(box, false)
    expect((await deliver(mime({}), 'alice-box+news@mail.test')).rejected).toBe(REJECT_UNAVAILABLE)
    expect(await messageRows()).toHaveLength(0)
  })

  it('counts subaddressed mail against the base mailbox hourly cap', async () => {
    const box = await addMailbox(aliceId, 'alice-box@mail.test')
    await optIn(box)
    const vars = { INGEST_MAX_PER_MAILBOX_PER_HOUR: '2' }
    const results = []
    for (const tag of ['a', 'b', 'c']) results.push((await deliver(mime({}), `alice-box+${tag}@mail.test`, {}, vars)).rejected)
    expect(results).toEqual([null, null, REJECT_FLOODED])
  })
})

describe('flood protection and ingest budget', () => {
  it('defaults to 10 messages per mailbox per hour', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const results = []
    for (let i = 0; i < 11; i++) results.push((await deliver(mime({}), 'alice-box@mail.test')).rejected)
    expect(results.slice(0, 10)).toEqual(Array(10).fill(null))
    expect(results[10]).toBe(REJECT_FLOODED)
  })

  it('caps messages per mailbox per hour, even for concurrent deliveries', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const vars = { INGEST_MAX_PER_MAILBOX_PER_HOUR: '2' }
    const stubs = await Promise.all(Array.from({ length: 6 }, () => deliver(mime({}), 'alice-box@mail.test', {}, vars)))
    expect(stubs.filter((s) => s.rejected === null)).toHaveLength(2)
    expect(stubs.filter((s) => s.rejected === REJECT_FLOODED)).toHaveLength(4)
    expect(await messageRows()).toHaveLength(2)
  })

  it('caps messages per user per hour across all of their mailboxes', async () => {
    const vars = { INGEST_MAX_PER_USER_PER_HOUR: '3' }
    for (const name of ['a', 'b', 'c', 'd']) await addMailbox(aliceId, `${name}@mail.test`)
    const results = []
    for (const name of ['a', 'b', 'c', 'd']) results.push((await deliver(mime({}), `${name}@mail.test`, {}, vars)).rejected)
    expect(results).toEqual([null, null, null, REJECT_FLOODED])
  })

  it('exempts admin accounts from the hourly caps, but not from the daily budget', async () => {
    const adminId = await createUser('boss', { role: 'admin' })
    await addMailbox(adminId, 'boss@mail.test')
    const rate = { INGEST_MAX_PER_MAILBOX_PER_HOUR: '1', INGEST_MAX_PER_USER_PER_HOUR: '1' }
    const results = []
    for (let i = 0; i < 4; i++) results.push((await deliver(mime({}), 'boss@mail.test', {}, rate)).rejected)
    expect(results).toEqual([null, null, null, null])
    expect((await deliver(mime({}), 'boss@mail.test', {}, { ...rate, INGEST_MAX_MESSAGES_PER_DAY: '4' })).rejected).toBe(REJECT_OVER_BUDGET)
  })

  it('stops all intake once the daily message budget is spent', async () => {
    const bobId = await createUser('bob')
    await addMailbox(aliceId, 'alice-box@mail.test')
    await addMailbox(bobId, 'bob-box@mail.test')
    const vars = { INGEST_MAX_MESSAGES_PER_DAY: '2' }
    expect((await deliver(mime({}), 'alice-box@mail.test', {}, vars)).rejected).toBeNull()
    expect((await deliver(mime({}), 'bob-box@mail.test', {}, vars)).rejected).toBeNull()
    expect((await deliver(mime({}), 'alice-box@mail.test', {}, vars)).rejected).toBe(REJECT_OVER_BUDGET)
    expect((await deliver(mime({}), 'bob-box@mail.test', {}, vars)).rejected).toBe(REJECT_OVER_BUDGET)
  })

  it('stops intake when the daily byte budget would be exceeded', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    // Each message stores ~250 KB of HTML; 1 MB/day fits four of them.
    const vars = { INGEST_MAX_MB_PER_DAY: '1', INGEST_PARSE_WINDOW_KB: '1024' }
    const results = []
    for (let i = 0; i < 5; i++) results.push((await deliver(mime({ html: `<p>${'x'.repeat(250_000)}</p>` }), 'alice-box@mail.test', {}, vars)).rejected)
    expect(results).toEqual([null, null, null, null, REJECT_OVER_BUDGET])
    expect(await messageRows()).toHaveLength(4)
  })

  it('does not count rejected mail against the budget', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    const vars = { INGEST_MAX_PER_MAILBOX_PER_HOUR: '1' }
    await deliver(mime({}), 'alice-box@mail.test', {}, vars)
    await deliver(mime({}), 'alice-box@mail.test', {}, vars)
    const counter = await env.DB.prepare('SELECT messages FROM ingest_counters').first<{ messages: number }>()
    expect(counter?.messages).toBe(1)
  })

  it('honours a smaller parse window from INGEST_PARSE_WINDOW_KB', async () => {
    await addMailbox(aliceId, 'alice-box@mail.test')
    await deliver(mime({ html: `<p>${'x'.repeat(100_000)}</p>` }), 'alice-box@mail.test', {}, { INGEST_PARSE_WINDOW_KB: '64' })
    const [row] = await messageRows()
    expect(row!.is_truncated).toBe(1)
    expect((row!.html_body as string).length).toBeLessThanOrEqual(64 * 1024)
  })
})
