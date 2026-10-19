import { describe, expect, it } from 'vitest'

import { extractVerificationCode } from '../worker/lib/otp'
import { htmlToText, truncateUtf8 } from '../worker/lib/text'

const cases: [label: string, subject: string, body: string, expected: string | null][] = [
  // English
  ['en: plain sentence', 'Verify your email', 'Your verification code is 482913. It expires in 10 minutes.', '482913'],
  ['en: code in subject first', '123456 is your Instagram code', 'Someone tried to sign in. Order 7781 placed.', '123456'],
  ['en: alphanumeric', 'Sign in', 'Use code G7K2PQ to finish signing in.', 'G7K2PQ'],
  ['en: grouped digits', 'Login', 'Your one-time passcode: 482 913', '482913'],
  ['en: dashed digits', 'Login', 'Security code: 4821-9130', '48219130'],
  ['en: copyright year ignored', 'Welcome', '© 2026 Example Inc. Your code is 839201.', '839201'],
  ['en: PIN', 'Your PIN', 'Your PIN is 7712.', '7712'],
  // Chinese
  ['zh: 冒号格式', '登录验证', '【示例】验证码：482913，10分钟内有效，请勿泄露。', '482913'],
  ['zh: 无空格紧贴', '验证', '您的验证码是7712，请勿告诉他人。', '7712'],
  ['zh: 电话号码不误判', '验证', '客服电话 400-820-1234。验证码 6655。', '6655'],
  ['zh: 金额不误判', '订单', '订单金额 ¥1299，验证码 528341', '528341'],
  // Japanese
  ['ja: 認証コード', 'ログイン', '認証コード: 384756 を入力してください。', '384756'],
  ['ja: 確認コードは…です', '確認', '確認コードは 551203 です。', '551203'],
  // Should find nothing
  ['none: newsletter', 'Weekly digest', 'Read our top 10 stories this week. Unsubscribe anytime.', null],
  ['none: order without keyword', 'Order shipped', 'Order #20251018 total $1234 ships to 10001.', null],
  ['none: time and room', 'Meeting', 'Meeting at 10:30 in room 2045.', null],
  ['none: keyword but only a year', 'Code of conduct', 'Updated in 2026.', null],
  ['none: year is the only number near a keyword', 'Promo', 'Use promo code below. Offer valid through 2026', null],
  ['none: zh 年份紧邻关键词', '说明', '验证码使用说明（2026 版）', null],
  ['none: lowercase word with digits', 'Video', 'Download the mp4 file, encoded with h264 code.', null],
  ['none: URL digits', 'Verify', 'Verify here: https://example.com/verify?id=829301', null],
  // False positives found in the Phase 3 security review
  ['review: promo code', 'Sale', 'Use promo code SAVE20 at checkout for 20% off.', null],
  ['review: zip code', 'Address updated', 'Your ZIP code was changed to 94107.', null],
  ['review: card ending in', 'Verify purchase', 'Please verify a purchase on your card ending in 4321.', null],
  ['review: subject card vs body code', 'Verify card ending 4321', 'Your verification code is 552901.', '552901'],
  ['review: ticket number in subject', '[Ticket 58213] Your verification code', 'Your code is 662211.', '662211'],
  ['review: compact date', 'Verification', 'Verification completed on 20261019.', null],
  ['review: rupee amount', 'Verify', 'Please verify the payment of ₹2499.', null],
  ['review: won amount', 'Verify', 'verify payment ₩15000', null],
  ['review: USD before', 'Verify', 'verify payment of USD 15000', null],
  ['review: USD after', 'Verify', 'verify payment of 15000 USD', null],
  ['review: spaced phone number', 'Code', 'If you did not request a code, call 415 555 0132.', null],
  ['review: intl phone number', 'Code', 'Questions about your code? +44 2079 460018', null],
  ['review: time of day', 'Verification', 'Verification window opens at 1430 UTC.', null],
  ['review: duration', 'Code', 'The code is valid for 1440 minutes.', null],
  ['review: parcel number', 'Delivery code', 'Your delivery code for parcel 9400 1000 is ready.', null],
  ['review: error code', 'Error', 'Login failed with error code E40312.', null],
  ['review: model number', 'Code', 'The QR code works with model XR5000.', null],
  ['review: ISO date', 'Verify', 'Verify before 2026-10-19.', null],
  // False negatives found in the review
  ['review: fullwidth digits', 'ログイン', '認証コード：４８２９１３', '482913'],
  ['review: GitHub-style pairs', 'Sign in', 'Verification code: 48 29 13', '482913'],
  ['review: keyword far before code', 'Sign in', 'Here is the code you requested to sign in to your account from a new device: 482913', '482913'],
  ['review: 取件码', '快递', '您的包裹已到驿站，取件码 8866，请及时领取。', '8866'],
]

describe('extractVerificationCode', () => {
  it.each(cases)('%s', (_label, subject, body, expected) => {
    expect(extractVerificationCode(subject, body)).toBe(expected)
  })

  it('works on text derived from an HTML-only message', () => {
    const html = '<html><head><style>.x{color:red}</style></head><body><p>Your code is <b>918&#50;73</b></p></body></html>'
    expect(extractVerificationCode('Sign in', htmlToText(html))).toBe('918273')
  })
})

describe('text helpers', () => {
  it('converts HTML to readable text without scripts or styles', () => {
    expect(htmlToText('<script>alert(1)</script><p>Hello&nbsp;<b>world</b></p><p>A &amp; B</p>')).toBe('Hello world\nA & B')
  })

  it('truncates on UTF-8 byte limits without splitting characters', () => {
    expect(truncateUtf8('abc', 10)).toEqual({ value: 'abc', truncated: false })
    const cut = truncateUtf8('验证码验证码', 7) // 3 bytes per char
    expect(cut).toEqual({ value: '验证', truncated: true })
  })
})
