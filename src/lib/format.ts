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
