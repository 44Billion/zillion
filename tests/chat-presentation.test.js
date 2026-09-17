import { test } from 'node:test'
import assert from 'node:assert/strict'
import { noteEncode, appEncode, nfileEncode, neventEncode } from 'libp2r2p/nip19'
import { extractMedia } from 'libp2r2p/nip27'
import { augmentedContentItems, chatQuoteModel, chatTimeline, groupChatDays } from '#helpers/chat-timeline.js'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { createFileMetadata } from 'libp2r2p/nip94'
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

test('kind 9 references expand to quotes and attachments by URI position', () => {
  const secret = new Uint8Array(32).fill(7)
  const pubkey = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
  const inner = event => ({ ...event, pubkey, id: getEventHash({ ...event, pubkey }) })
  const parent = inner({ kind: 9, created_at: 1, content: 'Parent text', tags: [] })
  const root = 'ab'.repeat(32)
  const file = inner(createFileMetadata({
    root, size: 1, mime: 'image/png', width: 1, height: 1, caption: 'A caption', created_at: 2,
    url: `https://nostr.alt/${nfileEncode({ root, mime: 'image/png', filename: 'one.png' })}?localOnly=1`
  }))
  const uri = event => `nostr:${neventEncode({ id: event.id, author: pubkey, kind: event.kind })}`
  const references = { [parent.id]: parent, [file.id]: file }
  const reply = inner({ kind: 9, created_at: 3, content: `${uri(parent)}\nLook at this`, tags: [['q', parent.id, '', pubkey]] })
  const image = inner({ kind: 9, created_at: 4, content: uri(file), tags: [['q', file.id, '', pubkey]] })
  const legacy = inner({ kind: 9, created_at: 5, content: 'Only a q tag', tags: [['q', parent.id, '', pubkey]] })

  const [replyMessage, imageMessage, legacyMessage] = chatTimeline([reply, image, legacy], { references, locale: 'en' })
  // The URI position wins and the duplicate `q` tag does not duplicate the block.
  assert.deepEqual(replyMessage.references.map(reference => [reference.id, reference.fromQ, reference.fromUri, reference.position]), [[parent.id, true, true, 0]])
  assert.deepEqual(replyMessage.prepend, [])
  assert.equal(replyMessage.quoted.text, 'Parent text')
  assert.equal(replyMessage.displayText, 'Look at this')
  assert.equal(imageMessage.attachment.filename, 'one.png')
  assert.equal(imageMessage.caption, 'A caption')
  assert.deepEqual(imageMessage.prepend, [])
  // A `q` without a URI renders before the content.
  assert.deepEqual(legacyMessage.prepend.map(reference => reference.id), [parent.id])
  assert.equal(legacyMessage.quoted.text, 'Parent text')
  // File metadata never becomes a bubble of its own.
  assert.equal(chatTimeline([file], { references }).length, 0)
  assert.equal(chatQuoteModel(image, references).caption, 'A caption')
  assert.equal(chatQuoteModel(image, references).content, uri(file), 'raw content stays available for reply thumbnails')
  // Expanded blocks own their line: the single break between them is
  // structural, while an authored double break still asks for a blank line.
  const pair = () => parseChatContent(`${uri(parent)}\n${uri(file)}`)
  assert.deepEqual(augmentedContentItems(pair(), references).map(item => item.key), ['event', 'event'])
  const spaced = augmentedContentItems(parseChatContent(`${uri(parent)}\n\ntexto`), references)
  assert.deepEqual(spaced.map(item => item.key), ['event', 'text'])
  assert.equal(spaced[1].text.value, '\ntexto')
  const replied = augmentedContentItems(parseChatContent(`${uri(parent)}\ntexto`), references)
  assert.deepEqual(replied.map(item => item.key), ['event', 'text'])
  assert.equal(replied[1].text.value, 'texto')
  // A plain space, tab or any other whitespace right after a block is the same
  // structural separator and would otherwise indent the next line.
  const inline = augmentedContentItems(parseChatContent(`${uri(parent)} texto`), references)
  assert.deepEqual(inline.map(item => item.key), ['event', 'text'])
  assert.equal(inline[1].text.value, 'texto')
  assert.equal(augmentedContentItems(parseChatContent(`${uri(parent)}\ttexto`), references)[1].text.value, 'texto')
  assert.equal(augmentedContentItems(parseChatContent(`${uri(parent)}\u00a0texto`), references)[1].text.value, 'texto')
  const mixed = augmentedContentItems(parseChatContent(`${uri(parent)}\t\n\ntexto`), references)
  assert.equal(mixed[1].text.value, '\ntexto', 'extra line breaks survive the consumed run')
  // Unresolved references stay inline, so their separator is untouched.
  assert.deepEqual(augmentedContentItems(pair(), {}).map(item => item.key), ['event', 'text', 'event'])
  // Kinds without an augmentation stay inline references.
  const note = inner({ kind: 1, created_at: 6, content: 'hello', tags: [] })
  const quotedNote = inner({ kind: 9, created_at: 7, content: uri(note), tags: [] })
  const [noteMessage] = chatTimeline([quotedNote], { references: { [note.id]: note }, locale: 'en' })
  assert.equal(noteMessage.quoted, null)
  assert.equal(noteMessage.displayText, shortNostrLabel(uri(note)))
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
