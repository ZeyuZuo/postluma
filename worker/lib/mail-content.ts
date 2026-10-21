import type { Email } from 'postal-mime'

import { stripUnsafeText } from '../../shared/api'
import { extractVerificationLink } from './magic-link'
import { extractVerificationCode } from './otp'
import { encodeSenderAuth, parseSenderAuth } from './sender-auth'
import { collapseWhitespace, htmlToText, sliceChars, truncateUtf8 } from './text'

// Sized for the D1 free tier (500 MB total): verification mail is a few KB, newsletters rarely
// exceed this, and the parse window (worker/email.ts) bounds them anyway.
export const MAX_HTML_BYTES = 256_000
export const MAX_TEXT_BYTES = 64_000
/** Only this much HTML is converted to text — enough for snippets and code detection. */
const HTML_TO_TEXT_CHARS = 64_000
const MAX_SUBJECT_CHARS = 998 // RFC 5322 line length
const MAX_NAME_CHARS = 200
const MAX_FILENAME_CHARS = 255
const MAX_HEADER_VALUE_CHARS = 998
const MAX_ATTACHMENTS = 50
const SNIPPET_CHARS = 200

export interface PreparedAttachment {
  filename: string | null
  contentType: string
  size: number
  contentId: string | null
  inline: boolean
}

export interface PreparedMessage {
  messageIdHeader: string | null
  envelopeFrom: string
  fromAddress: string
  fromName: string | null
  subject: string
  snippet: string
  textBody: string | null
  htmlBody: string | null
  verificationCode: string | null
  /** An https link the mail asks the reader to open (verify / confirm / sign in). */
  verificationLink: string | null
  /** Compact SPF/DKIM/DMARC results (sender-auth.ts), or null. */
  authResults: string | null
  /** Size of the original message as delivered (not what we store). */
  size: number
  /** Bytes this message adds to D1, for the daily ingest budget. */
  storedBytes: number
  truncated: boolean
  /** Real attachments, not inline images referenced by the HTML. */
  hasAttachments: boolean
  attachmentsJson: string | null
}

const encoder = new TextEncoder()
const byteLength = (value: string | null) => (value ? encoder.encode(value).byteLength : 0)

function contentSize(content: ArrayBuffer | Uint8Array | string): number {
  return typeof content === 'string' ? encoder.encode(content).byteLength : content.byteLength
}

/** Display text from headers: attacker-controlled, so strip spoofing characters and cap length. */
function displayText(value: string | undefined | null, max: number): string | null {
  if (!value) return null
  const clean = sliceChars(stripUnsafeText(value.replace(/\s+/g, ' ')).trim(), max)
  return clean === '' ? null : clean
}

/**
 * Turns a parsed email into what we store. Header-derived fields (From, subject, filenames) are
 * unauthenticated display data; delivery and ownership come from the envelope recipient only.
 * `windowTruncated` is true when only a prefix of the raw message was parsed.
 */
export function prepareMessage(
  email: Email,
  envelope: { from: string; rawSize: number; windowTruncated: boolean; senderAuth?: boolean },
): PreparedMessage {
  const html = email.html ? truncateUtf8(email.html, MAX_HTML_BYTES) : null
  const text = email.text !== undefined ? truncateUtf8(email.text, MAX_TEXT_BYTES) : null
  // Derived text feeds the snippet and code detection only; it is never stored.
  const scanText = text?.value ?? (html ? htmlToText(html.value.slice(0, HTML_TO_TEXT_CHARS)) : '')
  const subject = displayText(email.subject, MAX_SUBJECT_CHARS) ?? ''
  const from = email.from && 'address' in email.from && email.from.address ? email.from : null

  const attachments: PreparedAttachment[] = email.attachments.slice(0, MAX_ATTACHMENTS).map((a) => ({
    filename: displayText(a.filename, MAX_FILENAME_CHARS),
    contentType: sliceChars(a.mimeType, 255),
    size: contentSize(a.content),
    contentId: a.contentId ? sliceChars(a.contentId, MAX_HEADER_VALUE_CHARS) : null,
    inline: a.disposition === 'inline' || Boolean(a.related),
  }))
  const attachmentsJson = attachments.length > 0 ? JSON.stringify(attachments) : null

  const prepared: Omit<PreparedMessage, 'storedBytes'> = {
    messageIdHeader: email.messageId ? sliceChars(email.messageId, MAX_HEADER_VALUE_CHARS) : null,
    envelopeFrom: sliceChars(envelope.from, 320),
    fromAddress: sliceChars(from?.address ?? envelope.from, 320),
    fromName: displayText(from?.name, MAX_NAME_CHARS),
    subject,
    // Collapse first: newlines are control characters and must become spaces, not vanish.
    snippet: sliceChars(stripUnsafeText(collapseWhitespace(scanText)), SNIPPET_CHARS),
    textBody: text?.value ?? null,
    htmlBody: html?.value ?? null,
    verificationCode: extractVerificationCode(subject, scanText),
    verificationLink: extractVerificationLink(subject, html?.value ?? null, text?.value ?? null),
    authResults: envelope.senderAuth ? encodeSenderAuth(parseSenderAuth(email.headers)) : null,
    size: envelope.rawSize,
    truncated:
      envelope.windowTruncated ||
      Boolean(html?.truncated) ||
      Boolean(text?.truncated) ||
      email.attachments.length > MAX_ATTACHMENTS,
    hasAttachments: attachments.some((a) => !a.inline),
    attachmentsJson,
  }
  const storedBytes =
    byteLength(prepared.htmlBody) +
    byteLength(prepared.textBody) +
    byteLength(prepared.subject) +
    byteLength(prepared.snippet) +
    byteLength(attachmentsJson) +
    byteLength(prepared.verificationLink) +
    512 // ids, addresses, headers, row overhead
  return { ...prepared, storedBytes }
}
