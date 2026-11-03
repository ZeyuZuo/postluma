import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'

import type { MessageListResponse } from '../shared/api'
import { addDomain, addMailboxRow, addMessageRow, api, createUser, json, login } from './helpers'

const personal = { SERVICE_MODE: 'personal' }
let cookie: string
let box: string

beforeEach(async () => {
  const domainId = await addDomain('mail.test')
  box = await addMailboxRow(await createUser('root', { role: 'admin' }), domainId, 'root@mail.test')
  cookie = await login('root')
})

const star = (id: string, starred: boolean, vars: Record<string, string> = {}) =>
  api(`/api/messages/${id}`, { cookie, method: 'PATCH', body: { starred }, env: { ...personal, ...vars } })
const list = async (query = '') => json<MessageListResponse>(await api(`/api/messages${query}`, { cookie, env: personal }))
const starredCount = async () =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM messages WHERE is_starred = 1').first<{ n: number }>())!.n

describe('starring (personal mode)', () => {
  it('stars and unstars a message', async () => {
    const kept = await addMessageRow(box, { subject: 'keep me' })
    await addMessageRow(box, { subject: 'other' })
    expect((await star(kept, true)).status).toBe(204)
    expect((await list()).items.find((m) => m.id === kept)?.isStarred).toBe(true)
    expect((await list('?starred=1')).items.map((m) => m.id)).toEqual([kept])
    expect((await star(kept, false)).status).toBe(204)
    expect((await list('?starred=1')).items).toEqual([])
  })

  it('stops at MAX_STARRED_MESSAGES', async () => {
    const ids = [await addMessageRow(box), await addMessageRow(box), await addMessageRow(box)]
    const cap = { MAX_STARRED_MESSAGES: '2' }
    expect((await star(ids[0]!, true, cap)).status).toBe(204)
    expect((await star(ids[1]!, true, cap)).status).toBe(204)
    const third = await star(ids[2]!, true, cap)
    expect(third.status).toBe(409)
    expect(await json(third)).toEqual({ error: 'star_limit_reached' })
    // Starring one that is already starred is a no-op, also at the cap.
    expect((await star(ids[0]!, true, cap)).status).toBe(204)
    expect(await starredCount()).toBe(2)
  })

  it('lets concurrent stars past the cap only once', async () => {
    const [a, b] = [await addMessageRow(box), await addMessageRow(box)]
    const cap = { MAX_STARRED_MESSAGES: '1' }
    const statuses = (await Promise.all([star(a, true, cap), star(b, true, cap)])).map((r) => r.status).sort()
    expect(statuses).toEqual([204, 409])
    expect(await starredCount()).toBe(1)
  })

  it('keeps starred mail of a disabled address in the Starred filter', async () => {
    const kept = await addMessageRow(box, { subject: 'receipt' })
    expect((await star(kept, true)).status).toBe(204)
    await env.DB.prepare("UPDATE mailboxes SET status = 'disabled' WHERE id = ?").bind(box).run()
    expect((await list('?starred=1')).items.map((m) => m.id)).toEqual([kept])
    // The plain inbox still shows active addresses only.
    expect((await list()).items).toEqual([])
  })

  it('answers 404 for an unknown message', async () => {
    expect((await star('missing', true)).status).toBe(404)
    expect((await star('missing', false)).status).toBe(404)
  })
})

describe('temporary mode has no starring', () => {
  it('refuses to star or to filter by star, and still marks read', async () => {
    const id = await addMessageRow(box)
    expect((await api(`/api/messages/${id}`, { cookie, method: 'PATCH', body: { starred: true } })).status).toBe(404)
    expect((await api('/api/messages?starred=1', { cookie })).status).toBe(404)
    expect((await api(`/api/messages/${id}`, { cookie, method: 'PATCH', body: { isRead: true } })).status).toBe(204)
    expect(await starredCount()).toBe(0)
  })
})
