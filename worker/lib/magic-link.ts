/**
 * Heuristic verification-link ("magic link") detection for zh / en / ja mail.
 *
 * Candidates are https links: `<a href>` anchors in the HTML body, or bare URLs in the text body
 * when there is no HTML. A link scores for what its button says ("Verify email" beats "Log in"),
 * for its URL (/verify, ?token=…) and for the words just before it (or the subject). Links that
 * read as unsubscribe/privacy/help footers never qualify, and neither do URLs carrying credentials
 * (`https://bank.example@evil.example`). Returns null rather than guessing.
 */

/** Anchor text that only a verification button says. */
const STRONG_TEXT_RE =
  /\b(verify|verification|confirm|activate|validate|magic[\s-]?link)\b|验证|驗證|确认|確認|激活|启用|認証|有効化/i
/** Anchor text that newsletters say too: needs the URL or the context to agree. */
const LOGIN_TEXT_RE = /\b(sign[\s-]?in|log[\s-]?in|login|reset (your )?password)\b|登录|登入|重置密码|ログイン|サインイン/i
const URL_KEYWORDS = /verif|confirm|activat|validat|magic|token|otp|passwordless/i
/** A plain /login page isn't a magic link; one carrying a long one-time value is. */
const URL_LOGIN = /sign-?in|log-?in|auth/i
const LONG_VALUE = /[=/][\w-]{16,}/
const NEGATIVE_RE =
  /unsubscribe|opt[\s-]?out|preferences|privacy|terms|policy|help|support|contact|feedback|view (it )?in (your )?browser|web ?version|退订|取消订阅|隐私|帮助|配信停止|プライバシー/i

const SCORE_STRONG_TEXT = 3
const SCORE_LOGIN_TEXT = 2
const SCORE_URL = 2
const SCORE_CONTEXT = 1
const MIN_SCORE = 3

/** A button label, not a paragraph that happens to be a link. */
const MAX_ANCHOR_TEXT = 60
const CONTEXT_CHARS = 120
export const MAX_LINK_CHARS = 2048
/** Verification mail is short; bounds CPU on huge newsletters. */
const SCAN_CHARS = 64_000
const MAX_CANDIDATES = 200

const ANCHOR_RE = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi
const TEXT_URL_RE = /https:\/\/[^\s<>"'()[\]{}]+/gi

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole
  })
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()

/** The URL if it is a plain https link we'd show the user, else null. */
function safeHttps(raw: string): string | null {
  const value = raw.trim()
  if (value.length > MAX_LINK_CHARS || !/^https:\/\//i.test(value)) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname.includes('.')) return null
  return url.href.length > MAX_LINK_CHARS ? null : url.href
}

interface Candidate {
  url: string
  text: string
  context: string
}

function score(c: Candidate, subjectHit: boolean): number {
  const url = new URL(c.url)
  if (NEGATIVE_RE.test(c.text) || NEGATIVE_RE.test(url.pathname)) return 0
  const label = c.text.length <= MAX_ANCHOR_TEXT ? c.text : ''
  let total = 0
  if (STRONG_TEXT_RE.test(label)) total += SCORE_STRONG_TEXT
  else if (LOGIN_TEXT_RE.test(label)) total += SCORE_LOGIN_TEXT
  const target = url.pathname + url.search
  if (URL_KEYWORDS.test(target) || (URL_LOGIN.test(target) && LONG_VALUE.test(target))) total += SCORE_URL
  if (subjectHit || STRONG_TEXT_RE.test(c.context) || LOGIN_TEXT_RE.test(c.context)) total += SCORE_CONTEXT
  return total
}

function htmlCandidates(html: string): Candidate[] {
  const scan = html.slice(0, SCAN_CHARS)
  const out: Candidate[] = []
  for (const m of scan.matchAll(ANCHOR_RE)) {
    if (out.length >= MAX_CANDIDATES) break
    const url = safeHttps(decodeEntities(m[1] ?? m[2] ?? m[3] ?? ''))
    if (!url) continue
    const before = stripTags(scan.slice(Math.max(0, m.index - CONTEXT_CHARS * 4), m.index))
    out.push({ url, text: stripTags(m[4] ?? ''), context: before.slice(-CONTEXT_CHARS) })
  }
  return out
}

function textCandidates(text: string): Candidate[] {
  const scan = text.slice(0, SCAN_CHARS)
  const out: Candidate[] = []
  for (const m of scan.matchAll(TEXT_URL_RE)) {
    if (out.length >= MAX_CANDIDATES) break
    // Trailing sentence punctuation isn't part of the URL.
    const url = safeHttps(m[0].replace(/[.,;:!?。，；：！？]+$/, ''))
    if (!url) continue
    out.push({ url, text: '', context: scan.slice(Math.max(0, m.index - CONTEXT_CHARS), m.index) })
  }
  return out
}

export function extractVerificationLink(subject: string, html: string | null, text: string | null): string | null {
  const candidates = html ? htmlCandidates(html) : []
  if (candidates.length === 0 && text) candidates.push(...textCandidates(text))
  const subjectHit = STRONG_TEXT_RE.test(subject) || LOGIN_TEXT_RE.test(subject)
  let best: string | null = null
  let bestScore = MIN_SCORE - 1
  for (const c of candidates) {
    const s = score(c, subjectHit)
    if (s > bestScore) {
      best = c.url
      bestScore = s
    }
  }
  return best
}
