import PostalMime, { type Email } from 'postal-mime'

import { getConfig, mailBucket } from './lib/config'
import { newId } from './lib/crypto'
import { prepareMessage } from './lib/mail-content'
import { deleteRaw, rawKey } from './lib/raw-mail'
import {
  findDeliveryTarget,
  ingestBlock,
  rawBytesToday,
  storeMessage,
  type DeliveryTarget,
  type IngestBlock,
  type StoredRaw,
} from './repo/ingest'

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
 * Subaddresses (`name+tag@`) reach `name@` only when that mailbox opted in (findDeliveryTarget).
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

  const config = getConfig(env)
  const receivedAt = Date.now()
  // Cheap pre-check so floods don't cost a parse each; storeMessage re-checks atomically.
  const block = await ingestBlock(env.DB, target, receivedAt, 0, config.ingest)
  if (block) {
    message.setReject(BLOCK_REASONS[block])
    return
  }

  // The original goes to R2 only if this deployment has a bucket and today's R2 budget has room.
  const bucket = mailBucket(env)
  const keepRaw =
    bucket !== null &&
    message.rawSize > 0 &&
    (await rawBytesToday(env.DB, receivedAt)) + message.rawSize <= config.ingest.rawBytesPerDay
  const [parseStream, rawStream] = keepRaw ? message.raw.tee() : [message.raw, null]

  // Only a prefix is read and parsed: parsing (mostly base64-decoding attachments we never store)
  // dominates CPU, and the Workers Free plan allows 10 ms per invocation. Beyond it: truncated.
  const raw = await readPrefix(parseStream, config.ingest.parseWindowBytes)
  let email: Email
  try {
    email = await PostalMime.parse(raw.bytes, PARSE_LIMITS)
  } catch (err) {
    // Malformed MIME fails identically on every retry; bounce instead of looping.
    console.warn('Rejecting unparseable message', { mailboxId: target.mailboxId, error: String(err) })
    await rawStream?.cancel()
    message.setReject(REJECT_MALFORMED)
    return
  }

  const prepared = prepareMessage(email, {
    from: message.from,
    rawSize: message.rawSize,
    windowTruncated: raw.truncated,
  })
  const id = newId()
  const stored = bucket && rawStream ? await putRaw(bucket, rawStream, target, id, message.rawSize) : null
  const result = await storeMessage(env.DB, target, id, prepared, stored, receivedAt, config.ingest)
  if (!result.stored) {
    if (stored) await deleteRaw(bucket, [stored.key])
    message.setReject(BLOCK_REASONS[result.reason])
  }
}

/**
 * Copies chunks by hand: workerd can't pipeTo() from a tee() branch into another TransformStream.
 * Chunks are passed through untouched, so this costs a few microseconds per 64 KB.
 */
async function pump(from: ReadableStream<Uint8Array>, to: WritableStream<Uint8Array>): Promise<void> {
  const reader = from.getReader()
  const writer = to.getWriter()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      await writer.write(value)
    }
    await writer.close()
  } catch (err) {
    await writer.abort(err).catch(() => {})
    await reader.cancel(err).catch(() => {})
    throw err
  }
}

/**
 * Streams the original into R2 (no CPU spent on the bytes). R2 needs the length up front, which
 * Email Routing provides. A failure only means this message has no original; delivery goes on.
 */
async function putRaw(
  bucket: R2Bucket,
  stream: ReadableStream<Uint8Array>,
  target: DeliveryTarget,
  id: string,
  size: number,
): Promise<StoredRaw | null> {
  const key = rawKey(target.userId, id)
  try {
    const sized = new FixedLengthStream(size)
    const [, object] = await Promise.all([
      pump(stream, sized.writable),
      bucket.put(key, sized.readable, { httpMetadata: { contentType: 'message/rfc822' } }),
    ])
    return { key, bytes: object.size }
  } catch (err) {
    console.warn('Could not store the original message', { mailboxId: target.mailboxId, error: String(err) })
    await deleteRaw(bucket, [key])
    return null
  }
}
