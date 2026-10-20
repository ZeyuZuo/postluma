/**
 * Reads the original message (kept in R2) in the browser: attachment content and inline images.
 * The Worker never decodes attachments (Free plan: 10 ms CPU), so this is where they come from.
 * Everything here is attacker-controlled: filenames are only text-interpolated, downloads are
 * always application/octet-stream, and inline images become data: URIs for the sandboxed frame.
 */
import type { Attachment } from 'postal-mime'

import { messageApi } from '@/api/messages'

export interface OriginalAttachment {
  filename: string | null
  contentType: string
  size: number
  content: ArrayBuffer
}

export interface OriginalMail {
  /** The complete bodies (D1 only holds what fit in the server's parse window). Untrusted. */
  html: string | null
  text: string | null
  /** Real attachments, in message order (same classification as the server's metadata). */
  files: OriginalAttachment[]
  /** Content-ID (without angle brackets) → data: URI, images only. */
  inlineImages: Map<string, string>
}

/** Bigger inline images are left out: they would bloat the frame's srcdoc. */
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024
const IMAGE_TYPE = /^image\/[a-z0-9.+-]+$/

const PARSE_LIMITS = { maxNestingDepth: 20, maxPartCount: 500 }

function toArrayBuffer(content: Attachment['content']): ArrayBuffer {
  if (typeof content === 'string') return new TextEncoder().encode(content).buffer as ArrayBuffer
  if (content instanceof ArrayBuffer) return content
  return content.slice().buffer as ArrayBuffer
}

function toDataUri(type: string, content: ArrayBuffer): string {
  const bytes = new Uint8Array(content)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${type};base64,${btoa(binary)}`
}

/** Mirrors worker/lib/mail-content.ts: inline parts and parts the HTML references aren't "files". */
function isInline(a: Attachment): boolean {
  return a.disposition === 'inline' || Boolean(a.related)
}

/** The last few parsed originals, so reopening a large message doesn't download it again. */
const cache = new Map<string, Promise<OriginalMail>>()
const CACHE_SIZE = 4

export function loadOriginal(messageId: string): Promise<OriginalMail> {
  const hit = cache.get(messageId)
  if (hit) {
    cache.delete(messageId)
    cache.set(messageId, hit)
    return hit
  }
  const pending = fetchOriginal(messageId)
  cache.set(messageId, pending)
  pending.catch(() => cache.delete(messageId))
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return pending
}

/** Forget a message's original (it was deleted). */
export function forgetOriginal(messageId: string): void {
  cache.delete(messageId)
}

async function fetchOriginal(messageId: string): Promise<OriginalMail> {
  const [{ default: PostalMime }, raw] = await Promise.all([import('postal-mime'), messageApi.raw(messageId)])
  const email = await PostalMime.parse(raw, PARSE_LIMITS)
  const files: OriginalAttachment[] = []
  const inlineImages = new Map<string, string>()
  for (const a of email.attachments) {
    const content = toArrayBuffer(a.content)
    const type = a.mimeType.toLowerCase()
    if (a.contentId && IMAGE_TYPE.test(type) && content.byteLength <= MAX_INLINE_IMAGE_BYTES) {
      inlineImages.set(a.contentId.replace(/^<|>$/g, ''), toDataUri(type, content))
    }
    if (!isInline(a)) files.push({ filename: a.filename ?? null, contentType: a.mimeType, size: content.byteLength, content })
  }
  return { html: email.html ?? null, text: email.text ?? null, files, inlineImages }
}

/** Saves a file without ever letting the browser render it (no sniffing, no inline display). */
export function saveFile(content: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
