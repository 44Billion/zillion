import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createI18n } from 'thenameisf/i18n'
import locales from '../landing/src/i18n/locales.json' with { type: 'json' }
import appLocales from '../src/i18n/locales.json' with { type: 'json' }
import { SUPPORTED_LOCALES, browserLocale, normalizePreference } from '../landing/src/i18n/preferences.js'

test('landing catalogs cover the same locales as the app and every rendered source key', async () => {
  assert.deepEqual([...SUPPORTED_LOCALES].sort(), Object.keys(Object.values(appLocales)[0]).sort())
  const i18n = createI18n({
    supportedLocales: SUPPORTED_LOCALES, initialLocale: 'en', fallbackLocale: 'en',
    validation: { requiredLocales: 'supported', referenceLocale: 'en', requireReferenceKey: true }
  })
  const t = i18n.getT(locales)
  for (const locale of SUPPORTED_LOCALES) {
    i18n.setLocale(locale)
    for (const key of Object.keys(locales)) assert.ok(t(key, { current: 'A', next: 'B' }).trim())
    assert.equal(t('Privacy runs\ndeeper.').split('\n').length, 2)
    assert.ok(!t('Theme: {{current}}. Switch to {{next}}.', { current: 'A', next: 'B' }).includes('{{'))
  }
  for (const directory of ['landing/src/components', 'landing/src/i18n']) {
    for (const file of await readdir(directory, { recursive: true })) {
      if (!file.endsWith('.js')) continue
      const source = await readFile(`${directory}/${file}`, 'utf8')
      for (const match of source.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) {
        const key = match[1].replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\')
        assert.ok(locales[key], `Missing source key in ${file}: ${key}`)
      }
    }
  }
})

test('browser language priority, regional variants and explicit English fallback', () => {
  for (const [languages, expected] of [
    [['pt-PT', 'en-US'], 'pt-BR'], [['fr-CA'], 'fr'], [['de-AT'], 'de'],
    [['zh-Hant'], 'zh-TW'], [['zh-HK'], 'zh-TW'], [['zh-SG'], 'zh-CN'],
    [['zh-Hans'], 'zh-CN'], [['ja-JP'], 'ja'], [['ko-KR'], 'ko'],
    [['xx', 'es-MX', 'en'], 'es'], [['en-GB', 'fr'], 'en'],
    [['bad tag', 'ru-RU'], 'ru'], [['pt_BR'], 'pt-BR'], [['ar'], 'en'], [[], 'en']
  ]) assert.equal(browserLocale(languages), expected, languages.join(', '))
  for (const locale of SUPPORTED_LOCALES) assert.equal(normalizePreference(locale), locale)
  for (const value of ['auto', null, '', 'unsupported', 'pt-PT']) assert.equal(normalizePreference(value), 'auto')
})
