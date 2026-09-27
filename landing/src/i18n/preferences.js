import { resolveLocale } from '#f/i18n'

// Kept independent of the launcher's app instance; a test checks locale parity.
export const SUPPORTED_LOCALES = Object.freeze([
  'en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko'
])
export const storageKey = 'zillion:landing:locale'
export const normalizePreference = value => SUPPORTED_LOCALES.includes(value) ? value : 'auto'

export function browserLocale (languages) {
  for (const candidate of languages) {
    try {
      const language = new Intl.Locale(candidate.replaceAll('_', '-')).language
      if (SUPPORTED_LOCALES.some(locale => new Intl.Locale(locale).language === language)) {
        return resolveLocale(candidate, { supportedLocales: SUPPORTED_LOCALES, fallbackLocale: 'en' })
      }
    } catch { /* Skip malformed browser language tags. */ }
  }
  return 'en'
}

export function readPreference () {
  try { return normalizePreference(localStorage.getItem(storageKey)) } catch { return 'auto' }
}
