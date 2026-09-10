import { useTask } from '#f'
import { createI18n, useI18nProvider } from '#f/i18n/reactive'

export const SUPPORTED_LOCALES = Object.freeze([
  'en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko'
])

export const i18n = createI18n({
  supportedLocales: SUPPORTED_LOCALES,
  initialLocale: 'en',
  fallbackLocale: 'en',
  deferNotifications: true,
  validation: {
    requiredLocales: 'supported', referenceLocale: 'en', requireReferenceKey: true
  },
  browser: { syncDocumentLanguage: true }
})

export function useInitI18n () {
  useI18nProvider(i18n)
  // The launcher sends the initial locale through this subscription too.
  useTask(({ cleanup }) => cleanup(window.napp.onLocaleChanged(i18n.setLocale)))
}

export { getT, useT } from '#f/i18n/reactive'
