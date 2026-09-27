import { useGlobalStore, useTask } from '#f'
import { createI18n, useI18nProvider, getT } from '#f/i18n/reactive'
import { SUPPORTED_LOCALES, browserLocale, normalizePreference, readPreference, storageKey } from './preferences.js'
import locales from './locales.json' with { type: 'json' }

const deviceLocale = () => browserLocale(navigator.languages?.length ? navigator.languages : [navigator.language])
const initialPreference = readPreference()
export const i18n = createI18n({
  supportedLocales: SUPPORTED_LOCALES,
  initialLocale: initialPreference === 'auto' ? deviceLocale() : initialPreference,
  fallbackLocale: 'en',
  deferNotifications: true,
  validation: { requiredLocales: 'supported', referenceLocale: 'en', requireReferenceKey: true },
  browser: { syncDocumentLanguage: true }
})
export const t = getT(locales)

export function useLanguage () {
  return useGlobalStore('zillion:landing:locale', () => ({
    preference$: initialPreference,
    choose (value) {
      const preference = normalizePreference(value)
      this.preference$(preference)
      try { localStorage.setItem(storageKey, preference) } catch { /* Switching works without storage. */ }
    }
  }))
}

export function useInitI18n () {
  useI18nProvider(i18n)
  const state = useLanguage()
  useTask(({ track }) => {
    const preference = track(() => state.preference$())
    i18n.setLocale(preference === 'auto' ? deviceLocale() : preference)
  })
  useTask(({ cleanup }) => {
    const onLanguage = () => {
      if (state.preference$() === 'auto') i18n.setLocale(deviceLocale())
    }
    const onStorage = event => {
      if (event.key === storageKey || event.key === null) state.preference$(normalizePreference(event.newValue))
    }
    window.addEventListener('languagechange', onLanguage)
    window.addEventListener('storage', onStorage)
    cleanup(() => {
      window.removeEventListener('languagechange', onLanguage)
      window.removeEventListener('storage', onStorage)
    })
  })
  useTask(({ track }) => {
    const [title, description] = track(() => [t('Zillion — Privacy runs deeper.'), t('Private messaging on Nostr, protected by two keys working together. No download required.')])
    document.title = title
    document.querySelector('meta[name="description"]').content = description
    document.querySelector('meta[property="og:title"]').content = title
    document.querySelector('meta[property="og:description"]').content = description
  })
}
