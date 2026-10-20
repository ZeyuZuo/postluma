/** Originals in R2: stored on delivery (within budget), served only to the owner, deleted with the row. */
import { createExecutionContext, env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MessageDetail, MessageListResponse } from '../shared/api'
import { REJECT_MALFORMED, handleEmail } from '../worker/email'
import { runCleanup } from '../worker/jobs/cleanup'
import { addDomain, addMailboxRow, api, createUser, emailStub, json, login, mime } from './helpers'

let aliceId: string
let cookie: string

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  aliceId = await createUser('alice')
  await addMailboxRow(aliceId, domainId, 'alice@mail.test')
  cookie = await login('alice')
})

async function deliver(raw: string, vars: Record<string, unknown> = {}, rawSize?: number) {
  const stub = emailStub(raw, { to: 'alice@mail.test', rawSize })
  await handleEmail(stub, { ...env, ...vars } as Env, createExecutionContext())
  return stub
}

async function objects(): Promise<string[]> {
  return (await env.MAIL_BUCKET.list()).objects.map((o) => o.key)
}

async function onlyMessage(): Promise<MessageDetail> {
  const list = await json<MessageListResponse>(await api('/api/messages', { cookie }))
  expect(list.items).toHaveLength(1)
  return (await json<{ message: MessageDetail }>(await api(`/api/messages/${list.items[0]!.id}`, { cookie }))).message
}

const RAW = mime({ subject: 'With original', text: 'see attachment' })
const RAW_BYTES = new TextEncoder().encode(RAW.replace(/\r?\n/g, '\r\n'))

describe('storing originals', () => {
  it('keeps the exact bytes under u/<user>/<message>.eml and counts them against the R2 budget', async () => {
    expect((await deliver(RAW)).rejected).toBeNull()
    const message = await onlyMessage()
    expect(message.hasRaw).toBe(true)
    expect(await objects()).toEqual([`u/${aliceId}/${message.id}.eml`])
    const object = await env.MAIL_BUCKET.get(`u/${aliceId}/${message.id}.eml`)
    expect(new Uint8Array(await object!.arrayBuffer())).toEqual(RAW_BYTES)
    const counters = await env.DB.prepare('SELECT raw_bytes FROM ingest_counters').first<{ raw_bytes: number }>()
    expect(counters?.raw_bytes).toBe(RAW_BYTES.byteLength)
  })

  it('keeps the whole original even when only a prefix is parsed', async () => {
    const big = mime({ subject: 'Big', text: 'x'.repeat(400 * 1024) })
    expect((await deliver(big)).rejected).toBeNull()
    const message = await onlyMessage()
    expect(message.isTruncated).toBe(true)
    const object = await env.MAIL_BUCKET.get((await objects())[0]!)
    expect(object!.size).toBe(new TextEncoder().encode(big.replace(/\r?\n/g, '\r\n')).byteLength)
  })

  it('stores mail without an original when there is no bucket, the budget is spent or R2 refuses', async () => {
    await deliver(RAW, { MAIL_BUCKET: undefined })
    await deliver(RAW, { RAW_MAIL_MAX_MB_PER_DAY: '0' })
    await deliver(RAW, {}, RAW_BYTES.byteLength + 10) // wrong rawSize: the sized upload fails
    const { results } = await env.DB.prepare('SELECT raw_r2_key FROM messages').all<{ raw_r2_key: string | null }>()
    expect(results).toEqual([{ raw_r2_key: null }, { raw_r2_key: null }, { raw_r2_key: null }])
    expect(await objects()).toEqual([])
  })

  it('leaves nothing in R2 for rejected mail', async () => {
    const malformed = ['From: a@example.org', 'Subject: nested', 'Message-ID: <n@x>', 'MIME-Version: 1.0']
    for (let i = 0; i < 30; i++) malformed.push(`Content-Type: multipart/mixed; boundary="b${i}"`, '', `--b${i}`)
    expect((await deliver(malformed.join('\n'))).rejected).toBe(REJECT_MALFORMED)
    expect((await deliver(RAW, { INGEST_MAX_MESSAGES_PER_DAY: '1' })).rejected).toBeNull()
    expect((await deliver(RAW, { INGEST_MAX_MESSAGES_PER_DAY: '1' })).rejected).not.toBeNull()
    expect(await objects()).toHaveLength(1)
  })
})

describe('serving and deleting originals', () => {
  it('serves the original to its owner as an opaque download', async () => {
    await deliver(RAW)
    const message = await onlyMessage()
    const res = await api(`/api/messages/${message.id}/raw`, { cookie })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/octet-stream')
    expect(res.headers.get('content-disposition')).toBe('attachment; filename="message.eml"')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(RAW_BYTES)
  })

  it('answers 404 when no original was kept', async () => {
    await deliver(RAW, { RAW_MAIL_MAX_MB_PER_DAY: '0' })
    const message = await onlyMessage()
    expect(message.hasRaw).toBe(false)
    expect((await api(`/api/messages/${message.id}/raw`, { cookie })).status).toBe(404)
  })

  it('deletes the original with the message', async () => {
    await deliver(RAW)
    const message = await onlyMessage()
    expect((await api(`/api/messages/${message.id}`, { cookie, method: 'DELETE' })).status).toBe(204)
    expect(await objects()).toEqual([])
  })

  it('deletes originals in retention cleanup and admin purges', async () => {
    await deliver(RAW)
    await deliver(RAW)
    await env.DB.prepare('UPDATE messages SET received_at = 0 WHERE rowid = (SELECT MIN(rowid) FROM messages)').run()
    expect((await runCleanup(env)).messagesDeleted).toBe(1)
    expect(await objects()).toHaveLength(1)

    await createUser('root', { role: 'admin' })
    const admin = await login('root')
    await env.DB.prepare("UPDATE users SET status = 'banned' WHERE id = ?").bind(aliceId).run()
    const res = await api(`/api/admin/users/${aliceId}/purge-messages`, { cookie: admin, body: {} })
    expect(await json(res)).toMatchObject({ deleted: 1, done: true })
    expect(await objects()).toEqual([])
  })
})
