import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationMedia, mediaSwipe, selectedMediaId, isVideoControlPointer } from '../src/helpers/conversation-media.js'

test('conversation media keeps message order, resolved attachments and repeated sends, excluding download links and quotes', () => {
  const references = {
    file: { kind: 1063, content: 'Caption', tags: [['url', 'https://example.com/photo.jpg'], ['m', 'image/jpeg']] },
    quote: { kind: 9, content: 'https://example.com/quoted.jpg', tags: [] }
  }
  const messages = [
    { id: 'a', real: true, text: 'https://example.com/a.jpg https://example.com/clip.mp4 https://example.com/file.pdf' },
    { id: 'b', real: true, text: '', prepend: [{ id: 'file' }, { id: 'quote' }] },
    { id: 'c', real: true, text: 'https://example.com/a.jpg' },
    { id: 'd', attachment: { url: 'https://example.com/download.jpg', mime: 'image/jpeg', download: '1' } }
  ]
  const media = conversationMedia(messages, references)
  assert.deepEqual(media.map(item => item.url), ['https://example.com/a.jpg', 'https://example.com/clip.mp4', 'https://example.com/photo.jpg', 'https://example.com/a.jpg'])
  assert.equal(new Set(media.map(item => item.id)).size, 4)
  assert.equal(media[1].type, 'video')
  assert.equal(media[2].caption, 'Caption')
  assert.deepEqual(conversationMedia([], references), [])
  assert.deepEqual(conversationMedia([{ id: 'other', real: true, text: 'https://example.com/other.jpg' }], references).map(item => item.messageId), ['other'])
  assert.equal(selectedMediaId('#' + encodeURIComponent(media[2].id)), media[2].id)
  assert.equal(selectedMediaId('#%xx'), '')
})

test('swipes require a deliberate distance and follow their dominant axis', () => {
  assert.equal(mediaSwipe(49, 10), null)
  assert.deepEqual(mediaSwipe(-70, 20), { axis: 'x', step: 1 })
  assert.deepEqual(mediaSwipe(80, -20), { axis: 'x', step: -1 })
  assert.deepEqual(mediaSwipe(20, -100), { axis: 'y', step: 1 })
  assert.deepEqual(mediaSwipe(-10, 100), { axis: 'y', step: -1 })
})

test('video control strip and keyboard clicks remain native', () => {
  const video = { controls: true, getBoundingClientRect: () => ({ bottom: 300, height: 200 }) }
  const event = { target: { closest: () => video }, type: 'click', detail: 1, clientY: 270 }
  assert.equal(isVideoControlPointer(event), true)
  assert.equal(isVideoControlPointer({ ...event, clientY: 150 }), false)
  assert.equal(isVideoControlPointer({ ...event, detail: 0, clientY: 150 }), true)
})

test('URL snapshots exclude known file references, preserve occurrence order and do not keep messages', () => {
  const event = { kind: 1063, content: '', tags: [['url', 'https://example.com/file.jpg'], ['m', 'image/jpeg'], ['download', '1']] }
  const message = { id: 'message', real: true, created_at: 50, prepend: [{ id: 'file' }], references: [{ id: 'file' }], text: 'https://example.com/file.jpg https://example.com/extra.jpg https://example.com/extra.jpg', largeUnusedField: 'discard' }
  const extras = conversationMedia([message], { file: event }, { urlsOnly: true })
  assert.equal(extras.length, 1)
  assert.equal(extras[0].url, 'https://example.com/extra.jpg')
  assert.equal(extras[0].created_at, 50)
  assert.equal(extras[0].orderId, 'message')
  assert.equal(extras[0].largeUnusedField, undefined)
  const all = conversationMedia([message], { file: event })
  assert.equal(all[0].id, 'file:file')
  assert.equal(all[0].download, '1')
})
