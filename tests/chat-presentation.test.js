import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteEncode, appEncode } from 'libp2r2p/nip19'
import { extractMedia } from 'libp2r2p/nip27'
import { chatTimeline, groupChatDays } from '#helpers/chat-timeline.js'
import { parseChatContent } from '#helpers/chat-content.js'
import { shortNostrLabel, shortQuotedText, shortUrlLabel } from '#helpers/reference-label.js'
import { canPreviewNostrReference, createLinkPreviews, safePreviewUrl } from '#services/link-preview.js'

test('reference labels are compact without altering pointers, URL extensions or Unicode', () => {
  assert.equal(shortUrlLabel('https://www.example.com/'), 'example.com')
  assert.equal(shortUrlLabel('https://example.com/a-very-long-path'), 'example.com/a-very-lon…')
  assert.equal(shortUrlLabel('https://example.com/a-very-long-picture.jpeg', '.jpeg'), 'example.com/a-very…jpeg')
  const pointer = noteEncode('a'.repeat(64))
  assert.equal(shortNostrLabel('nostr:' + pointer), pointer.slice(0, 22) + '…')
  const unicode = shortUrlLabel('https://example.com/' + '😀'.repeat(20))
  assert.equal([...unicode].length, 23)
  assert.equal(unicode.isWellFormed(), true)
})

test('quoted text shortens references while preserving surrounding text and whitespace', () => {
  const pointer = noteEncode('a'.repeat(64))
  const url = 'https://example.com/a-very-long-picture.jpeg'
  assert.equal(shortQuotedText(`  See ${url}\n${pointer} #private  `), `  See ${shortUrlLabel(url, '.jpeg')}\n${shortNostrLabel(pointer)} #private  `)
  assert.equal(shortQuotedText(`https://njump.me/${pointer}`), shortNostrLabel(pointer))
  assert.equal(shortQuotedText('  Text <without> links\n😀  '), '  Text <without> links\n😀  ')
})

test('timeline groups consecutive local calendar days and keeps the clock separate', () => {
  const now = new Date(2026, 8, 12, 12).getTime()
  const times = [new Date(2026, 8, 10, 23), new Date(2026, 8, 11, 0), new Date(2026, 8, 11, 1), new Date(now)]
  const messages = chatTimeline(times.map((date, id) => ({ id, content: '  verbatim\ntext  ', created_at: date.getTime() / 1000, tags: [] })), { now, locale: 'en-US' })
  assert.deepEqual(messages.map(message => message.dayLabel), ['9/10/2026', 'Yesterday', null, 'Today'])
  assert.equal(messages[3].time, '12:00 PM')
  assert.equal(messages[3].text, 'verbatim\ntext')
  assert.equal(messages[3].status, 'saved')
  assert.equal(chatTimeline([{ id: 1, content: '?', tags: [], created_at: now / 1000, status: 'pending' }])[0].status, 'pending')
  assert.equal(chatTimeline([{ id: 1, content: '', tags: [], created_at: now / 1000 }], { now, locale: 'pt-BR', t: () => 'Hoje' })[0].dayLabel, 'Hoje')
})

test('timeline compacts historical messages and reply excerpts without changing event content or identity', () => {
  const content = '  First\t  line \r\n\n\n\n Second line  \n' + Array.from({ length: 10 }, (_, i) => `item ${i}`).join('\n') + '  '
  const event = { id: 'original-id', content, created_at: 1, tags: [] }
  const [message] = chatTimeline([event])
  const expected = 'First line\n\nSecond line\nitem 0\nitem 1\nitem 2\nitem 3\nitem 4\nitem 5 item 6 item 7 item 8 item 9'
  assert.equal(message.text, expected)
  assert.equal(shortQuotedText(message.text), expected)
  assert.equal(message.id, event.id)
  assert.equal(event.content, content)
})

test('day groups retain their identity when older messages arrive ahead of the current first message', () => {
  const at = new Date(2026, 8, 13, 12).getTime() / 1000
  const message = (id, offset) => ({ id, created_at: at + offset, content: id, tags: [] })
  const before = groupChatDays(chatTimeline([message('newer', 0)], { locale: 'en' }))
  const after = groupChatDays(chatTimeline([message('older', -60), message('newer', 0)], { locale: 'en' }))
  assert.equal(after.length, 1)
  assert.equal(after[0].key, before[0].key)
  assert.equal(after[0].label, before[0].label)
  assert.deepEqual(after[0].messages.map(message => message.id), ['older', 'newer'])
})

test('chat parsing delegates app references to the library and leaves concatenated pointers as text', () => {
  const id = 'a'.repeat(64)
  const pointer = noteEncode(id)
  const entity = appEncode({ pubkey: 'b'.repeat(64), dTag: 'zillion', channel: 'main' })
  const content = `before ${pointer} ${entity} nostr:++myapp@bob@example.com +apps after`
  const parts = parseChatContent(content)
  assert.deepEqual(parts, extractMedia(content))
  const apps = parts.filter(part => part.key === 'app')
  assert.equal(apps.length, 3)
  assert.equal(apps[0].app.entity, entity)
  assert.equal(apps[1].app.user.raw, 'bob.example.com')
  assert.equal(apps[2].app.user.raw, '44billion.net')
  assert.equal(shortQuotedText(content), `before ${shortNostrLabel(pointer)} ${shortNostrLabel(entity)} ${shortNostrLabel('nostr:++myapp@bob@example.com')} +apps after`)
  const concatenated = `before ${pointer}${entity} after`
  assert.deepEqual(parseChatContent(concatenated), [{ key: 'text', text: { value: concatenated } }])
  assert.equal(shortQuotedText(concatenated), concatenated)
  assert.equal(parseChatContent(`https://njump.me/${pointer}`)[0].event.id, id)
})

test('private references and unavailable provenance never go to an external preview service', async () => {
  const reference = { id: 'a'.repeat(64) }
  let queries = 0
  const options = {
    owner: 'b'.repeat(64), signer: { obfuscate: async () => 'mirror' },
    eventStore: { query: async filter => { queries++; return { results: filter['#o'] ? [{}] : [] } } }
  }
  assert.equal(await canPreviewNostrReference(reference, { ...options, knownMessages: [reference] }), false)
  assert.equal(queries, 0)
  assert.equal(await canPreviewNostrReference(reference, options), false)
  assert.equal(queries, 2)
  assert.equal(await canPreviewNostrReference({ kind: 1006 }, options), false)
  assert.equal(await canPreviewNostrReference({ kind: 30023, pubkey: options.owner, identifier: 'private' }, options), false)
  assert.equal(await canPreviewNostrReference(reference, { ...options, eventStore: { query: async () => { throw new Error('denied') } } }), false)
  assert.equal(await canPreviewNostrReference(reference, { ...options, eventStore: { query: async () => ({ results: [] }) } }), true)
})

test('preview URLs reject executable URLs and credentials, and resolve head-relative assets', () => {
  for (const value of ['', 'javascript:alert(1)', 'data:image/svg+xml,test', 'https://user:secret@example.com']) assert.equal(safePreviewUrl(value), null)
  assert.equal(safePreviewUrl('/icon.png', 'https://example.com/page'), 'https://example.com/icon.png')
})

test('preview reads stop at the head, cache results, and fall back on CORS failure', async () => {
  let requests = 0
  let cancelled = false
  const previews = createLinkPreviews({
    checkOnline: async () => true,
    fetchPage: async (url, options) => {
      requests++
      assert.equal(options.credentials, 'omit')
      assert.equal(options.referrerPolicy, 'no-referrer')
      if (url.includes('blocked')) throw new TypeError('CORS')
      return new Response(new ReadableStream({
        start (controller) { controller.enqueue(new TextEncoder().encode('<head>metadata</head><body>unneeded')) },
        cancel () { cancelled = true }
      }), { headers: { 'content-type': 'text/html' } })
    },
    parse: html => { assert.equal(html, '<head>metadata'); return { title: 'Example' } }
  })
  assert.equal((await previews.load('https://example.com')).title, 'Example')
  assert.equal(cancelled, true)
  await previews.load('https://example.com')
  assert.equal(requests, 1)
  const fallback = await previews.load('https://blocked.example.com/path')
  assert.equal(fallback.icon, 'https://blocked.example.com/favicon.ico')
  assert.equal(fallback.found, undefined)
  assert.equal(await createLinkPreviews({ checkOnline: async () => false }).load('https://example.com'), null)
})

test('preview size limit and failed/non-HTML pages do not become Nostr previews', async () => {
  let parsedBytes = 0
  const previews = createLinkPreviews({
    checkOnline: async () => true,
    fetchPage: async url => url.includes('large')
      ? new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'text/html' } })
      : new Response('Missing', { status: 404 }),
    parse: html => { parsedBytes = html.length; return {} }
  })
  await previews.load('https://large.example.com')
  assert.equal(parsedBytes, 256 * 1024)
  assert.equal((await previews.load('https://njump.me/missing')).found, undefined)
})

test('preview concurrency is bounded and queued cancellation leaves slots usable', async () => {
  let active = 0
  let peak = 0
  const finish = []
  const previews = createLinkPreviews({
    checkOnline: async () => true,
    fetchPage: async () => {
      peak = Math.max(peak, ++active)
      await new Promise(resolve => finish.push(resolve))
      active--
      return new Response('<head></head>', { headers: { 'content-type': 'text/html' } })
    },
    parse: () => ({})
  })
  const controller = new AbortController()
  const requests = Array.from({ length: 6 }, (_, i) => previews.load(`https://example.com/${i}`, i === 4 ? { signal: controller.signal } : {}))
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(active, 4)
  controller.abort()
  while (finish.length) {
    finish.shift()()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  assert.equal((await Promise.all(requests))[4], null)
  assert.equal(peak, 4)
})
