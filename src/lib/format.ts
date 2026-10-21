import { currentLocale, i18n } from '@/i18n'

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600_000],
  ['month', 30 * 24 * 3600_000],
  ['week', 7 * 24 * 3600_000],
  ['day', 24 * 3600_000],
  ['hour', 3600_000],
  ['minute', 60_000],
]

/** "3 minutes ago" / "3 分钟前"; anything under a minute reads as "just now". */
export function formatRelative(ms: number, now = Date.now()): string {
  const rtf = new Intl.RelativeTimeFormat(currentLocale(), { numeric: 'auto' })
  const diff = ms - now
  for (const [unit, size] of UNITS) {
    if (Math.abs(diff) >= size) return rtf.format(Math.round(diff / size), unit)
  }
  return i18n.global.t('common.justNow')
}

export function formatDateTime(ms: number): string {
  return new Intl.DateTimeFormat(currentLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

/** "42", or "99+" once a server-capped count reaches its cap. */
export function formatCount(n: number, cap: number): string {
  return n >= cap ? `${cap - 1}+` : String(n)
}

/** Compact list time: "14:32" today, "10月18日" / "Oct 18" this year, a full date before that. */
export function formatListTime(ms: number, now = Date.now()): string {
  const date = new Date(ms)
  const today = new Date(now)
  const locale = currentLocale()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  }
  if (date.getFullYear() === today.getFullYear()) {
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  }
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short' }).format(date)
}
