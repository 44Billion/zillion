import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nfileDecode, nfileEncode } from 'libp2r2p/nip19'
import { fileName, fitFileName, encodedFileName, fileDownloadSource, fileSize, fileCategory, attachmentSizeStyle } from '#helpers/attachment-presentation.js'

test('filenames prioritize supplied name, root, original hash, hash and translated generic name', () => {
  const file = { filename: 'report.pdf', root: 'ab'.repeat(32), originalSha256: 'cd'.repeat(32), sha256: 'ef'.repeat(32), mime: 'application/pdf' }
  assert.equal(fileName(file).full, 'report.pdf')
  delete file.filename
  assert.equal(fileName(file).full, file.root + '.pdf')
  delete file.root
  assert.equal(fileName(file).full, file.originalSha256 + '.pdf')
  delete file.originalSha256
  assert.equal(fileName(file).full, file.sha256 + '.pdf')
  assert.equal(fileName(file).generic, false)
  delete file.sha256
  assert.deepEqual(fileName(file, 'arquivo-sem-nome'), { base: 'arquivo-sem-nome', extension: '.pdf', full: 'arquivo-sem-nome.pdf', generic: true })
  assert.equal(fileName({ filename: 'README', mime: 'text/plain' }).full, 'README.txt')
  assert.equal(fileName({ filename: 'backup.tar.gz' }).full, 'backup.tar.gz')
  assert.equal(fileName({ filename: 'name.unknown', mime: 'image/png' }).full, 'name.unknown')
  assert.equal(fileName({ filename: 'data', mime: 'unknown/type' }).full, 'data.bin')
  assert.equal(fileName({}).full, 'unnamed-file.bin')
})

test('nfile encoding limits UTF-8 bytes while retaining extension and valid characters', () => {
  const filename = encodedFileName({ filename: '📎漢'.repeat(100) + '.pdf' })
  assert.ok(new TextEncoder().encode(filename).length <= 255)
  assert.ok(filename.endsWith('.pdf'))
  assert.ok(!filename.includes('�') && !filename.includes('…'))
  const reference = { root: 'ab'.repeat(32), filename }
  assert.equal(nfileDecode(nfileEncode(reference)).filename, filename)
  assert.equal(fileName({ filename: 'a/\r\nb.pdf' }).full, 'a___b.pdf')
})

test('derived download URLs retain root, hints and localOnly without mutating received metadata', () => {
  const reference = { root: 'ab'.repeat(32), author: 'cd'.repeat(32), relays: ['wss://relay.example.com'], mime: 'application/pdf' }
  const value = `https://nostr.alt/${nfileEncode(reference)}?localOnly=1#download=1`
  const file = Object.freeze({ url: value, root: reference.root })
  const result = new URL(fileDownloadSource(value, file))
  assert.equal(result.search, '?localOnly=1')
  assert.equal(result.hash, '')
  assert.deepEqual(nfileDecode(result.pathname.slice(1)), { ...reference, filename: reference.root + '.pdf' })
  assert.equal(file.url, value)
  const named = `https://nostr.alt/${nfileEncode({ ...reference, filename: 'report' })}?localOnly=1`
  assert.equal(nfileDecode(new URL(fileDownloadSource(named)).pathname.slice(1)).filename, 'report.pdf')
  assert.equal(fileDownloadSource('https://example.com/download?q=1#download=1'), 'https://example.com/download?q=1')
})

test('decimal byte sizes localize at most one decimal and handle rounding across units', () => {
  assert.equal(fileSize(1500000, 'pt-BR'), '1,5MB')
  assert.equal(fileSize(1500000, 'en'), '1.5MB')
  assert.equal(fileSize(98000000000, 'en'), '98GB')
  assert.equal(fileSize(999950, 'en'), '1MB')
  assert.equal(fileSize(0), '0B')
  for (const invalid of [undefined, null, -1, Infinity, NaN, '100']) assert.equal(fileSize(invalid), '')
  for (const locale of ['fr', 'it', 'de', 'es', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko']) {
    assert.equal(fileSize(1500000, locale), new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(1.5) + 'MB')
  }
})

test('file categories and bounded widths cover documents and extreme media proportions', () => {
  for (const [type, expected] of [['audio/mpeg', 'audio'], ['video/webm', 'media'], ['image/png', 'media'], ['application/pdf', 'document'], ['text/plain', 'document'], ['application/zip', 'archive'], ['application/octet-stream', 'other']]) assert.equal(fileCategory(type), expected)
  assert.match(attachmentSizeStyle({ width: 1, height: 10000 }), /^width: 160px/)
  assert.match(attachmentSizeStyle({ width: 10000, height: 1 }), /^width: 320px/)
  assert.match(attachmentSizeStyle({ width: Infinity, height: 1 }), /^width: 320px/)
})

test('fitted filenames join ellipsis and extension without whitespace and preserve graphemes', () => {
  const name = fileName({ filename: 'document.pdf' })
  const measure = value => [...value].length
  assert.equal(fitFileName(name, 12, measure), 'document.pdf')
  assert.equal(fitFileName(name, 8, measure), 'docu…pdf')
  assert.equal(fitFileName(name, 4, measure), '…pdf')
  assert.equal(fitFileName(name, 12, measure), name.full)
  const unicode = fileName({ filename: '👨‍👩‍👧‍👦á-long.pdf' })
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  const unicodeMeasure = value => [...graphemes.segment(value)].length
  assert.equal(fitFileName(unicode, 6, unicodeMeasure), '👨‍👩‍👧‍👦á…pdf')
})
