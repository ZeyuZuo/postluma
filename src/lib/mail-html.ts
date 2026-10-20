/**
 * Hostile-HTML handling for received mail. Three independent layers:
 * 1. DOMPurify strips scripts, event handlers, forms, embeds, frames and dangerous URLs.
 * 2. The srcdoc carries its own CSP: no scripts, no network except (opt-in) images.
 * 3. MailFrame renders it in an iframe sandbox without allow-scripts / allow-same-origin.
 * Remote images (tracking pixels) stay blocked until the user opts in for that message.
 */
import DOMPurify from 'dompurify'

const purifier = DOMPurify(window)

const FORBID_TAGS = [
  'script', 'noscript', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'base', 'meta', 'link',
  'form', 'input', 'button', 'select', 'option', 'textarea', 'svg', 'math', 'audio', 'video', 'source', 'track',
  'portal', 'template', 'slot',
  // Image maps carry links the anchor hook doesn't see; mail never needs them.
  'map', 'area',
]
const FORBID_ATTR = ['ping', 'formaction', 'action', 'srcdoc', 'autofocus']
const SAFE_LINK = /^(https?:|mailto:)/i

purifier.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName !== 'A' && node.tagName !== 'AREA') return
  const href = node.getAttribute('href')?.trim() ?? ''
  if (!SAFE_LINK.test(href)) node.removeAttribute('href')
  // Links open in a new tab, without telling the destination where they came from.
  node.setAttribute('target', '_blank')
  node.setAttribute('rel', 'noopener noreferrer')
})

// Remote references the CSP will block unless images are allowed (attributes and CSS url()).
const REMOTE_RESOURCE = /\b(?:src|srcset|background|poster)\s*=\s*["']?\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\//i

export interface PreparedMail {
  html: string
  hasRemoteImages: boolean
  /** Inline (cid:) images that could not be resolved yet. */
  hasInlineImages: boolean
}

// `src="cid:…"` (RFC 2392; the id may be percent-encoded).
const CID_SRC = /(\bsrc\s*=\s*)(["']?)cid:([^"'\s>]+)\2/gi

function decodeCid(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Sanitizes received HTML. `inlineImages` (Content-ID → data: URI, from the original message)
 * replaces cid: references first: DOMPurify drops cid: URLs, while data: images pass it and the
 * frame's CSP.
 */
export function prepareMailHtml(raw: string, inlineImages?: ReadonlyMap<string, string>): PreparedMail {
  let hasInlineImages = false
  const resolved = raw.replace(CID_SRC, (match, attr: string, quote: string, cid: string) => {
    const uri = inlineImages?.get(decodeCid(cid))
    if (uri) return `${attr}${quote}${uri}${quote}`
    hasInlineImages = true
    return match
  })
  const html = purifier.sanitize(resolved, {
    FORBID_TAGS,
    FORBID_ATTR,
    FORCE_BODY: true, // keep a leading <style>, which email layouts rely on
    ALLOW_DATA_ATTR: false,
  })
  // Detection only drives the "load images" button; the CSP blocks remote loads either way.
  // DOMPurify serializes quotes inside style attributes as entities, so decode them first.
  const decoded = html.replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&#39;|&#x27;|&apos;/gi, "'")
  return { html, hasRemoteImages: REMOTE_RESOURCE.test(decoded) || /\bsrcset\s*=/i.test(decoded), hasInlineImages }
}

const BASE_STYLE = `
  html { color-scheme: light; }
  body { margin: 0; padding: 20px; background: #fff; color: #1c2430; overflow-wrap: anywhere;
         font: 15px/1.6 system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
  img, table { max-width: 100%; }
  img { height: auto; }
  a { color: #2e5aac; }
`

/** Full document for the sandboxed iframe. `allowRemoteImages` relaxes img-src only. */
export function buildSrcdoc(sanitizedBody: string, allowRemoteImages: boolean): string {
  const imgSrc = allowRemoteImages ? 'data: https:' : 'data:'
  const csp = `default-src 'none'; style-src 'unsafe-inline'; img-src ${imgSrc}; font-src data:; form-action 'none'; base-uri 'none'`
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    // Belt and braces: every link opens a new tab even if one slipped past the sanitizer hook.
    '<base target="_blank">' +
    `<style>${BASE_STYLE}</style></head><body>${sanitizedBody}</body></html>`
  )
}

/** Splits plain text into text and http(s) link segments for safe rendering via Vue. */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = []
  const re = /\bhttps?:\/\/[^\s<>"'）)\]】]+/gi
  let last = 0
  for (const m of text.matchAll(re)) {
    const url = m[0].replace(/[.,;:!?。，；：！？]+$/, '')
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: url, href: url })
    last = m.index + url.length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}
