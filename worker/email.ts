import PostalMime, { type Email } from 'postal-mime'

import { prepareMessage } from './lib/mail-content'
import { findDeliveryTarget, ingestBlock, storeMessage, type IngestBlock } from './repo/ingest'

/**
 * Only this many bytes of a message are read and parsed. Parsing (mostly base64-decoding
 * attachments we never store) dominates CPU, and the Workers Free plan allows 10 ms per
 * invocation; verification mail is a few KB. Anything beyond is dropped and flagged truncated.
 */
export const PARSE_WINDOW_BYTES = 256 * 1024
const PARSE_LIMITS = { maxNestingDepth: 20, maxPartCount: 200, maxHeadersSize: 256 * 1024 }

/**
 * One reason for every "no such deliverable mailbox" case (unknown, disabled, owner not active,
 * non-ASCII), so bounces don't reveal which addresses exist or what state they are in.
 */
export const REJECT_UNAVAILABLE = 'Mailbox unavailable'
export const REJECT_MALFORMED = 'Message could not be parsed'
export const REJECT_FLOODED = 'Mailbox is receiving too many messages'
export const REJECT_OVER_BUDGET = 'Service is receiving too much mail'

const BLOCK_REASONS: Record<IngestBlock | 'unavailable', string> = {
  flooded: REJECT_FLOODED,
  over_budget: REJECT_OVER_BUDGET,
  unavailable: REJECT_UNAVAILABLE,
}

/** Printable ASCII only: JS `toLowerCase` would fold e.g. KELVIN SIGN to "k" (a fuzzy match). */
const ASCII_ADDRESS = /^[\x21-\x7e]+$/

async function readPrefix(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let truncated = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (total + value.byteLength > limit) {
      chunks.push(value.subarray(0, limit - total))
      total = limit
      truncated = true
      await reader.cancel()
      break
    }
    chunks.push(value)
    total += value.byteLength
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

/**
 * Email Routing catch-all entry point. Catch-all is only routing: mail is accepted solely for an
 * active mailbox of an active user, matched exactly on the lowercased envelope recipient.
 * Subaddresses (`name+tag@`) are not supported and therefore rejected.
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const recipient = message.to.trim()
  const target = ASCII_ADDRESS.test(recipient) ? await findDeliveryTarget(env.DB, recipient.toLowerCase()) : null
  if (!target) {
    message.setReject(REJECT_UNAVAILABLE)
    return
  }

  const receivedAt = Date.now()
  // Cheap pre-check so floods don't cost a parse each; storeMessage re-checks atomically.
  const block = await ingestBlock(env.DB, target, receivedAt, 0)
  if (block) {
    message.setReject(BLOCK_REASONS[block])
    return
  }

  const raw = await readPrefix(message.raw, PARSE_WINDOW_BYTES)
  let email: Email
  try {
    email = await PostalMime.parse(raw.bytes, PARSE_LIMITS)
  } catch (err) {
    // Malformed MIME fails identically on every retry; bounce instead of looping.
    console.warn('Rejecting unparseable message', { mailboxId: target.mailboxId, error: String(err) })
    message.setReject(REJECT_MALFORMED)
    return
  }

  const prepared = prepareMessage(email, {
    from: message.from,
    rawSize: message.rawSize,
    windowTruncated: raw.truncated,
  })
  const result = await storeMessage(env.DB, target, prepared, receivedAt)
  if (!result.stored) message.setReject(BLOCK_REASONS[result.reason])
}
