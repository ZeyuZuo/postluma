const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Cuts `value` to at most `maxBytes` of UTF-8 without splitting a character. */
export function truncateUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  // Every UTF-16 unit encodes to ≥1 byte, so this pre-cut never drops anything that would fit,
  // and spares encoding megabytes we would throw away.
  const head = value.length > maxBytes ? value.slice(0, maxBytes) : value
  const bytes = encoder.encode(head)
  if (bytes.byteLength <= maxBytes && head.length === value.length) return { value, truncated: false }
  if (bytes.byteLength <= maxBytes) return { value: head.replace(/[\uD800-\uDBFF]$/, ''), truncated: true }
  // A cut through a multi-byte sequence decodes to U+FFFD; drop that partial character.
  return { value: decoder.decode(bytes.subarray(0, maxBytes)).replace(/�+$/, ''), truncated: true }
}

/** `value.slice(0, max)` that never leaves half of a surrogate pair (emoji) at the end. */
export function sliceChars(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, max).replace(/[\uD800-\uDBFF]$/, '')
}

export function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  middot: '·',
  ndash: '–',
  mdash: '—',
  hellip: '…',
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match
  })
}

const RAW_TEXT_OPEN = /<(script|style|head|title|noscript)\b/gi

/**
 * Removes raw-text elements with a forward-only scan. (A regex like `<script[\s\S]*?<\/script>`
 * rescans the rest of the input for every unclosed tag — quadratic on hostile mail.)
 */
function stripRawTextBlocks(html: string): string {
  const lower = html.toLowerCase()
  let out = ''
  let i = 0
  for (;;) {
    RAW_TEXT_OPEN.lastIndex = i
    const open = RAW_TEXT_OPEN.exec(html)
    if (!open) return out + html.slice(i)
    out += `${html.slice(i, open.index)} `
    const close = lower.indexOf(`</${open[1]!.toLowerCase()}`, RAW_TEXT_OPEN.lastIndex)
    if (close === -1) return out // unclosed: drop the rest, as a browser would
    const end = html.indexOf('>', close)
    if (end === -1) return out
    i = end + 1
  }
}

/**
 * Plain-text view of an HTML body for snippets and code detection only — never rendered as HTML.
 * All steps are linear; `<[^<>]*>` (not `<[^>]*>`) keeps unclosed `<` from rescanning the input.
 */
export function htmlToText(html: string): string {
  const text = stripRawTextBlocks(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)\s*>/gi, '\n')
    .replace(/<[^<>]*>/g, ' ')
  return decodeEntities(text)
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n\s*/g, '\n')
    .trim()
}
