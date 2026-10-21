import { describe, expect, it } from 'vitest'

import { extractVerificationLink } from '../worker/lib/magic-link'

const a = (href: string, text: string) => `<a href="${href}" style="color:#fff">${text}</a>`

const cases: [label: string, subject: string, html: string | null, text: string | null, expected: string | null][] = [
  // Buttons
  ['en: verify button', 'Welcome', `<p>Thanks for signing up.</p>${a('https://app.example.com/verify?token=abc', 'Verify email address')}`, null, 'https://app.example.com/verify?token=abc'],
  ['en: confirm button behind a tracker', 'Welcome', `<p>One more step.</p>${a('https://u123.ct.sendgrid.net/ls/click?upn=xyz', 'Confirm your email')}`, null, 'https://u123.ct.sendgrid.net/ls/click?upn=xyz'],
  ['en: sign-in link by url and subject', 'Your sign-in link', `<p>Click below.</p>${a('https://lumen.example/auth/callback?token=t1', 'Open Lumen')}`, null, 'https://lumen.example/auth/callback?token=t1'],
  ['en: click here with context', 'Account', `<p>Click the link below to verify your email address:</p>${a('https://x.example/confirm/9f8e', 'click here')}`, null, 'https://x.example/confirm/9f8e'],
  ['en: entities in href', 'Verify', a('https://x.example/verify?id=1&amp;token=2', 'Verify'), null, 'https://x.example/verify?id=1&token=2'],
  ['en: button wins over footer', 'Welcome', `${a('https://x.example/help', 'Help center')}${a('https://x.example/activate?k=1', 'Activate account')}${a('https://x.example/unsubscribe', 'Unsubscribe')}`, null, 'https://x.example/activate?k=1'],
  // Chinese / Japanese
  ['zh: 验证邮箱按钮', '欢迎注册', `<p>请点击下方按钮完成验证</p>${a('https://cn.example.com/v?code=7', '验证邮箱')}`, null, 'https://cn.example.com/v?code=7'],
  ['zh: 登录链接 + 主题', '你的登录链接', a('https://cn.example.com/magic?t=1', '立即登录'), null, 'https://cn.example.com/magic?t=1'],
  ['ja: 確認ボタン', 'ご登録ありがとうございます', a('https://jp.example.com/c/abc', 'メールアドレスを確認'), null, 'https://jp.example.com/c/abc'],
  ['en: login url with a one-time value', 'Your login link', a('https://x.example/login/callback?k=Zm9vYmFyYmF6cXV4MTIz', 'Log in'), null, 'https://x.example/login/callback?k=Zm9vYmFyYmF6cXV4MTIz'],
  // Plain text
  ['text: url after keyword', 'Confirm your account', null, 'Confirm your account by visiting https://t.example/confirm?token=zz.', 'https://t.example/confirm?token=zz'],
  ['text: verify url', 'Verify', null, 'Verify here: https://example.com/verify?id=829301', 'https://example.com/verify?id=829301'],
  // Nothing
  ['none: newsletter log in', 'Weekly digest', `<p>Top stories.</p>${a('https://news.example/login', 'Log in')}`, null, null],
  ['none: unsubscribe confirm', 'Weekly digest', a('https://news.example/unsubscribe/confirm?u=1', 'Confirm unsubscribe'), null, null],
  ['none: http only', 'Verify', a('http://x.example/verify?token=1', 'Verify email'), null, null],
  ['none: credentials in url', 'Verify', a('https://bank.example@evil.example/verify', 'Verify email'), null, null],
  ['none: javascript url', 'Verify', a('javascript:alert(1)', 'Verify email'), null, null],
  ['none: privacy link with keyword url', 'Verify your email', a('https://x.example/privacy?token=1', 'Privacy'), null, null],
  ['none: long paragraph link', 'News', a('https://x.example/blog', 'Read how we verify every seller on our marketplace before they can list anything at all'), null, null],
  ['none: text without keywords', 'Hello', null, 'See https://example.com/blog/post-1 for more.', null],
]

describe('extractVerificationLink', () => {
  it.each(cases)('%s', (_label, subject, html, text, expected) => {
    expect(extractVerificationLink(subject, html, text)).toBe(expected)
  })

  it('prefers HTML anchors over the text part', () => {
    const html = a('https://x.example/verify?t=html', 'Verify email')
    const text = 'Verify: https://x.example/verify?t=text'
    expect(extractVerificationLink('Verify', html, text)).toBe('https://x.example/verify?t=html')
  })

  it('stays bounded on a huge body', () => {
    const filler = '<p>lorem ipsum</p>'.repeat(20_000)
    const started = performance.now()
    expect(extractVerificationLink('News', filler + a('https://x.example/verify', 'Verify email'), null)).toBeNull()
    expect(performance.now() - started).toBeLessThan(200)
  })
})
