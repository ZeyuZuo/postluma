import { Hono } from 'hono'

import {
  createMailboxSchema,
  isValidLocalPart,
  listMailboxesQuerySchema,
  normalizeLocalPart,
  updateMailboxSchema,
  type MailboxListResponse,
} from '../../shared/api'
import { randomLocalPart } from '../lib/address'
import { getConfig, type AppConfig } from '../lib/config'
import { ApiError } from '../lib/errors'
import { parseJson, parseQuery } from '../lib/request'
import { findEnabledDomain } from '../repo/domains'
import { createMailbox, getMailbox, getQuota, listMailboxes, updateMailbox, type MailboxLimits } from '../repo/mailboxes'
import type { AppEnv } from '../types'

const RANDOM_ATTEMPTS = 5

function mailboxLimits(config: AppConfig): MailboxLimits {
  return {
    defaultQuota: config.defaultMailboxQuota,
    maxTotal: config.maxTotalMailboxes,
    maxDailyCreations: config.maxDailyMailboxCreations,
  }
}

// Deliberately no DELETE: mailboxes are only ever disabled (docs/DEV_PLAN.md decision 4).
export const mailboxRoutes = new Hono<AppEnv>()

mailboxRoutes.get('/', async (c) => {
  const query = parseQuery(c, listMailboxesQuerySchema)
  const userId = c.get('user').id
  // Sequential on purpose: with Promise.all a rejected listing (bad cursor) would leave the quota
  // query running after the response is sent.
  const page = await listMailboxes(c.env.DB, userId, query)
  const body: MailboxListResponse = { ...page, quota: await getQuota(c.env.DB, userId, getConfig(c.env).defaultMailboxQuota) }
  return c.json(body)
})

mailboxRoutes.post('/', async (c) => {
  const input = await parseJson(c, createMailboxSchema)
  const userId = c.get('user').id
  const limits = mailboxLimits(getConfig(c.env))
  const domain = await findEnabledDomain(c.env.DB, input.domainId)
  if (!domain) throw new ApiError(400, 'domain_unavailable')
  const note = input.note ?? null

  if (input.localPart !== undefined) {
    const localPart = normalizeLocalPart(input.localPart)
    if (!isValidLocalPart(localPart)) throw new ApiError(400, 'invalid_local_part')
    const mailbox = await createMailbox(c.env.DB, userId, { domainId: domain.id, address: `${localPart}@${domain.domain}`, note }, limits)
    return c.json({ mailbox }, 201)
  }

  for (let attempt = 1; ; attempt++) {
    try {
      const address = `${randomLocalPart()}@${domain.domain}`
      const mailbox = await createMailbox(c.env.DB, userId, { domainId: domain.id, address, note }, limits)
      return c.json({ mailbox }, 201)
    } catch (err) {
      // A random collision is astronomically unlikely; retry a few times before giving up.
      if (!(err instanceof ApiError && err.code === 'address_taken') || attempt >= RANDOM_ATTEMPTS) throw err
    }
  }
})

mailboxRoutes.get('/:id', async (c) => {
  return c.json({ mailbox: await getMailbox(c.env.DB, c.get('user').id, c.req.param('id')) })
})

mailboxRoutes.patch('/:id', async (c) => {
  const patch = await parseJson(c, updateMailboxSchema)
  const defaultQuota = getConfig(c.env).defaultMailboxQuota
  return c.json({ mailbox: await updateMailbox(c.env.DB, c.get('user').id, c.req.param('id'), patch, defaultQuota) })
})
