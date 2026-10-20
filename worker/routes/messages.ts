import { Hono } from 'hono'

import { listMessagesQuerySchema, markReadSchema, summaryQuerySchema, updateMessageSchema } from '../../shared/api'
import { mailBucket } from '../lib/config'
import { ApiError } from '../lib/errors'
import { deleteRaw } from '../lib/raw-mail'
import { enforceRateLimit, parseJson, parseQuery } from '../lib/request'
import {
  deleteMessage,
  getInboxSummary,
  getMessage,
  getRawKey,
  listMessages,
  markAllRead,
  setMessageRead,
} from '../repo/messages'
import type { AppEnv } from '../types'

/**
 * The signed-in user's own mail only. Reading never changes state (GET stays side-effect free for
 * CSRF reasons); the client marks a message read with PATCH after opening it.
 */
export const messageRoutes = new Hono<AppEnv>()

messageRoutes.get('/', async (c) => {
  const q = parseQuery(c, listMessagesQuerySchema)
  return c.json(
    await listMessages(c.env.DB, c.get('user').id, {
      mailboxId: q.mailbox,
      q: q.q,
      cursor: q.cursor,
      since: q.since,
      unreadOnly: q.unread === '1',
      withCodeOnly: q.code === '1',
      limit: q.limit,
    }),
  )
})

messageRoutes.get('/summary', async (c) => {
  const q = parseQuery(c, summaryQuerySchema)
  return c.json(await getInboxSummary(c.env.DB, c.get('user').id, { known: q.known, recount: q.recount === '1' }))
})

messageRoutes.post('/mark-read', async (c) => {
  const { mailboxId } = await parseJson(c, markReadSchema)
  // Each call can write up to MARK_READ_BATCH rows; keep scripted loops from draining the budget.
  await enforceRateLimit(c.env, `mark-read:user:${c.get('user').id}`)
  return c.json({ updated: await markAllRead(c.env.DB, c.get('user').id, mailboxId) })
})

messageRoutes.get('/:id', async (c) => c.json({ message: await getMessage(c.env.DB, c.get('user').id, c.req.param('id')) }))

/**
 * The original message, as received. Served as an opaque download, never as message/rfc822 or
 * anything a browser might render on this origin; the client parses it for attachments.
 */
messageRoutes.get('/:id/raw', async (c) => {
  const bucket = mailBucket(c.env)
  if (!bucket) throw new ApiError(404, 'not_found')
  const object = await bucket.get(await getRawKey(c.env.DB, c.get('user').id, c.req.param('id')))
  if (!object) throw new ApiError(404, 'not_found')
  return c.body(object.body, 200, {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment; filename="message.eml"',
    'Content-Length': String(object.size),
  })
})

messageRoutes.patch('/:id', async (c) => {
  const { isRead } = await parseJson(c, updateMessageSchema)
  await setMessageRead(c.env.DB, c.get('user').id, c.req.param('id'), isRead)
  return c.body(null, 204)
})

messageRoutes.delete('/:id', async (c) => {
  const rawKey = await deleteMessage(c.env.DB, c.get('user').id, c.req.param('id'))
  await deleteRaw(mailBucket(c.env), [rawKey])
  return c.body(null, 204)
})
