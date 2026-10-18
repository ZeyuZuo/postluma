/**
 * Locale registry. To add a language: create src/locales/<tag>.ts typed as `Messages`,
 * then add one entry to LOCALES (and to SUPPORTED_LOCALES in shared/api.ts).
 */
import { createLocale, dateEnUS, dateZhCN, enUS, zhCN, type NDateLocale, type NLocale } from 'naive-ui'
import { createI18n } from 'vue-i18n'

import { SUPPORTED_LOCALES, type Locale } from '../shared/api'
import en from './locales/en'
import zh from './locales/zh-CN'

// Labels already say what to type; drop Naive's generic "Please Input" placeholder.
const quiet = (base: NLocale): NLocale => createLocale({ Input: { placeholder: '' } }, base)

export const LOCALES: Record<Locale, { label: string; naive: NLocale; naiveDate: NDateLocale; messages: typeof zh }> = {
  'zh-CN': { label: '简体中文', naive: quiet(zhCN), naiveDate: dateZhCN, messages: zh },
  en: { label: 'English', naive: quiet(enUS), naiveDate: dateEnUS, messages: en },
}

const STORAGE_KEY = 'postluma.locale'

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function readStoredLocale(): Locale | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return isLocale(value) ? value : null
  } catch {
    return null
  }
}

export function browserLocale(): Locale {
  for (const tag of navigator.languages) {
    if (isLocale(tag)) return tag
    if (tag.toLowerCase().startsWith('zh')) return 'zh-CN'
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: readStoredLocale() ?? browserLocale(),
  fallbackLocale: 'en',
  messages: Object.fromEntries(Object.entries(LOCALES).map(([tag, l]) => [tag, l.messages])),
})

export function currentLocale(): Locale {
  return i18n.global.locale.value as Locale
}

/** `null` means "follow the browser". */
export function applyLocale(locale: Locale | null): void {
  const resolved = locale ?? browserLocale()
  i18n.global.locale.value = resolved
  document.documentElement.lang = resolved
  try {
    if (locale) localStorage.setItem(STORAGE_KEY, locale)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode); the choice still applies for this visit.
  }
}
