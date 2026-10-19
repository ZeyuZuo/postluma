/**
 * Heuristic verification-code detection for zh / en / ja mail.
 *
 * Candidates: 4–8 digits (also grouped "482 913", "482-913", "48 29 13") and 5–8 char uppercase
 * alphanumerics. The candidate nearest a code keyword wins; generic keywords ("code", "verify",
 * "コード") count less than specific ones ("verification code", "验证码"). Numbers that read as
 * years, dates, money, phone/card/parcel/order numbers, times, durations or URL parts are ignored,
 * as are "promo code", "zip code", "error code" and friends. Returns null rather than guessing.
 */

const STRONG_KEYWORDS = [
  'verification code', 'security code', 'confirmation code', 'login code', 'sign-in code', 'sign in code',
  'access code', 'auth code', 'authentication code', 'one-time password', 'one-time code', 'one-time passcode',
  'passcode', 'otp', '2fa code', 'two-factor code',
]
const WEAK_KEYWORDS = ['verification', 'verify', 'code', 'pin']
const STRONG_CJK = [
  '验证码', '校验码', '动态码', '确认码', '安全码', '验证代码', '登录码', '动态密码', '取件码',
  '認証コード', '確認コード', '認証番号', '確認番号', '検証コード', 'ワンタイムパスワード', 'ワンタイム', 'パスコード', 'セキュリティコード',
]
const WEAK_CJK = ['代码', 'コード']
const WEAK_PENALTY = 15

const asciiAlternation = (words: string[]) => words.map((k) => `\\b${k.replace(/[-\s]/g, '[-\\s]?')}\\b`).join('|')
const KEYWORD_RE = new RegExp(
  `(${asciiAlternation(STRONG_KEYWORDS)}|${STRONG_CJK.join('|')})|(${asciiAlternation(WEAK_KEYWORDS)}|${WEAK_CJK.join('|')})`,
  'giu',
)
// "promo code", "zip code", "error code E4031", "QR code", "code of conduct" — not one-time codes.
const NOT_A_CODE_BEFORE =
  /\b(promo|promotion(al)?|coupon|discount|voucher|gift|zip|postal|post|area|country|error|status|qr|bar|source|tracking|dress|referral|invite|invitation|redeem|redemption)[\s-]*$/i
const NOT_A_CODE_AFTER = /^\s+of\b/i

const CANDIDATE_RE =
  /(?<![0-9A-Za-z])(\d{2}(?: \d{2}){2,3}|\d{3,4}[ -]\d{3,4}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{5,8})(?![0-9A-Za-z])/g

const BEFORE_BLOCK = new Set(['$', '¥', '€', '£', '₹', '₩', '₽', '₫', '฿', '#', '№', '/', '=', '+', '@', '&', '?', '%', '.', '-', '_'])
const AFTER_BLOCK = new Set(['%', '/', '@', '-', '_', '=', '元', '円'])
const CONTEXT_BEFORE =
  /(\b(tel|phone|fax|call|order|invoice|amount|total|price|ending(\s+in)?|ends\s+in|card|parcel|tracking|ticket|case|model|room|no|usd|eur|cny|jpy|rmb|hkd|gbp|aud|cad|inr|krw)|電話|电话|手机|号码|订单|注文|金额|合计|尾号|末尾|包裹|运单)\W{0,3}$/i
const CONTEXT_AFTER =
  /^\s?(usd|eur|cny|jpy|rmb|hkd|gbp|utc|gmt|[ap]\.?m\b|minutes?\b|mins?\b|hours?\b|hrs?\b|days?\b|seconds?\b|secs?\b|元|円|分钟|分|秒|小时|天|日|年|月|号|件|个|次)/i
const YEAR_RE = /^(19|20)\d{2}$/
const COMPACT_DATE_RE = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/

const KEYWORD_BEFORE_MAX = 80 // "Your code is …"
const KEYWORD_AFTER_MAX = 30 // "123456 is your code"
const SCAN_CHARS = 5_000 // codes sit near the top; bounds CPU on huge bodies

interface Span {
  start: number
  end: number
  penalty: number
}

function keywordSpans(text: string): Span[] {
  const spans: Span[] = []
  for (const m of text.matchAll(KEYWORD_RE)) {
    const start = m.index
    const end = start + m[0].length
    if (NOT_A_CODE_BEFORE.test(text.slice(Math.max(0, start - 24), start))) continue
    if (NOT_A_CODE_AFTER.test(text.slice(end, end + 6))) continue
    spans.push({ start, end, penalty: m[1] ? 0 : WEAK_PENALTY })
  }
  return spans
}

/** "415 555 0132", "4.821", "12,345,678": the candidate is one piece of a longer number. */
function partOfLongerNumber(text: string, start: number, end: number): boolean {
  const joinsBefore = /[ \-.,]/.test(text[start - 1] ?? '') && /\d/.test(text[start - 2] ?? '')
  const after = text.slice(end, end + 5)
  // A comma only continues a number as a thousands separator ("482913,10分钟" is a new clause).
  const joinsAfter = after[0] === ',' ? /^,\d{3}(?!\d)/.test(after) : /^[ \-.]\d/.test(after)
  return joinsBefore || joinsAfter
}

function isPlausible(text: string, start: number, end: number, code: string): boolean {
  const before = text[start - 1] ?? ''
  const after = text[end] ?? ''
  if (BEFORE_BLOCK.has(before) || AFTER_BLOCK.has(after)) return false
  // "10:3045"-style times; but "code:482913" is fine.
  if ((before === ':' && /\d/.test(text[start - 2] ?? '')) || after === ':') return false
  if (partOfLongerNumber(text, start, end)) return false
  if (CONTEXT_BEFORE.test(text.slice(Math.max(0, start - 24), start))) return false
  if (CONTEXT_AFTER.test(text.slice(end, end + 10))) return false
  if (YEAR_RE.test(code) || COMPACT_DATE_RE.test(code)) return false
  return true
}

function best(text: string): { code: string; score: number } | null {
  const spans = keywordSpans(text)
  if (spans.length === 0) return null
  let winner: { code: string; score: number } | null = null
  for (const m of text.matchAll(CANDIDATE_RE)) {
    const raw = m[1]!
    const start = m.index
    const end = start + raw.length
    const code = raw.replace(/[ -]/g, '')
    if (!isPlausible(text, start, end, code)) continue
    let distance = Infinity
    for (const s of spans) {
      if (s.end <= start && start - s.end <= KEYWORD_BEFORE_MAX) distance = Math.min(distance, start - s.end + s.penalty)
      else if (s.start >= end && s.start - end <= KEYWORD_AFTER_MAX) distance = Math.min(distance, s.start - end + 1 + s.penalty)
    }
    if (distance === Infinity) continue
    const score = distance + (code.length === 6 ? 0 : 0.5) // ties go to the common 6-digit shape
    if (!winner || score < winner.score) winner = { code, score }
  }
  return winner
}

function normalize(value: string): string {
  // NFKC turns fullwidth digits/letters (４８２９１３) into ASCII.
  return value.slice(0, SCAN_CHARS * 2).normalize('NFKC').replace(/\s+/g, ' ').slice(0, SCAN_CHARS)
}

export function extractVerificationCode(subject: string, body: string): string | null {
  const fromSubject = best(normalize(subject))
  const fromBody = best(normalize(body))
  if (fromSubject && (!fromBody || fromSubject.score <= fromBody.score)) return fromSubject.code
  return fromBody?.code ?? null
}
