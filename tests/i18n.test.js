import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createI18n } from 'thenameisf/i18n'
import locales from '../src/i18n/locales.json' with { type: 'json' }
import toastLocales from '../src/components/shared/toast-locales.json' with { type: 'json' }
import chat from '../src/components/views/chat/fixtures/messages.json' with { type: 'json' }
import home from '../src/components/views/home/fixtures/home.json' with { type: 'json' }

const supportedLocales = ['en', 'fr', 'it', 'de', 'es', 'pt-BR', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']

test('all catalogs cover launcher locales and preview strings, including unread plurals', () => {
  const i18n = createI18n({
    supportedLocales, fallbackLocale: 'en', initialLocale: 'en',
    validation: { requiredLocales: 'supported', referenceLocale: 'en', requireReferenceKey: true }
  })
  const t = i18n.getT(locales)
  const toast = i18n.getT(toastLocales)
  for (const locale of supportedLocales) {
    i18n.setLocale(locale)
    for (const key of Object.keys(locales)) assert.ok(t(key, { count: 3 }).length > 0)
    for (const key of Object.keys(toastLocales)) assert.ok(toast(key).length > 0)
    for (const message of [...chat.messages, ...chat.selfMessages]) {
      assert.ok(locales[message.text][locale])
      if (message.preview) assert.ok(locales[message.preview][locale])
    }
    for (const conversation of home.conversations) {
      assert.ok(locales[conversation.message][locale])
      if (!/^\d{2}:\d{2}$/.test(conversation.timeLabel)) assert.ok(locales[conversation.timeLabel][locale])
    }
  }
  i18n.setLocale('en')
  assert.equal(t('{{count}} unread messages', { count: 1 }), '1 unread message')
  assert.equal(t('{{count}} unread messages', { count: 3 }), '3 unread messages')
  i18n.setLocale('ru')
  assert.equal(t('{{count}} unread messages', { count: 2 }), '2 непрочитанных сообщения')
  assert.equal(t('{{count}} unread messages', { count: 5 }), '5 непрочитанных сообщений')
  i18n.setLocale(i18n.resolveLocale('unsupported'))
  assert.equal(toast('Close'), 'Close')
})
