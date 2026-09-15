import assert from 'node:assert/strict'
import { getEventHash } from 'libp2r2p/event'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export async function checkDownloadIntent ({ browser, evaluate, origin, downloads, photo, videoTags, png, videoBytes }) {
  await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true })
  const reveal = async row => {
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await browser.until(() => evaluate(`!(${row}).getAnimations({subtree:true}).length`), 'message geometry settled')
    // These fixtures are the latest messages. Explicitly return to the end;
    // pretending to scroll up can make the reading anchor undo a programmatic
    // scrollIntoView while the new message is still entering the layout.
    await evaluate('(() => { const timeline = document.querySelector(\'.chat-timeline\'); timeline.dispatchEvent(new KeyboardEvent(\'keydown\', {key:\'End\',bubbles:true})); timeline.scrollTop = timeline.scrollHeight; })()')
    await browser.until(() => evaluate(`(() => { const box = (${row}).getBoundingClientRect(); const viewport = document.querySelector('.chat-timeline').getBoundingClientRect(); return box.bottom > viewport.top && box.top < viewport.bottom; })()`), 'download fixture visible at the end')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  }
  let timestamp = Math.floor(Date.now() / 1000) + 60
  const insert = async (content, tags, kind = 1063) => {
    const event = { kind, content, tags, created_at: timestamp++ }
    const saved = await evaluate(`(async () => window.napp.eventStore.addPersonalCopy(${JSON.stringify(event)}, {context:'dm:' + await window.nostr.peekPublicKey()}))()`)
    assert.equal(saved.result.ok, true)
    const id = getEventHash({ ...event, pubkey: await evaluate('window.nostr.peekPublicKey()') })
    const row = `document.querySelector('[data-message-id="${id}"]')`
    await browser.until(() => evaluate(`!!(${row})`), 'received download metadata by exact ID')
    await reveal(row)
    return row
  }
  const download = async (anchor, filename, bytes, local = true) => {
    const href = await browser.until(() => evaluate(`(${anchor})?.getAttribute('href')`), 'prepared native download link')
    assert.ok(local ? href.startsWith(origin + '/~~nfile/') : href.startsWith('https://download.example.com/'))
    assert.equal(new URL(href).hash, '')
    const start = browser.downloads.length
    await evaluate(`(${anchor}).click()`)
    const event = await browser.until(() => browser.downloads.slice(start).find(event => event.method === 'Browser.downloadWillBegin'), 'Chrome starts native download')
    assert.equal(event.suggestedFilename, filename)
    await browser.until(async () => { try { return (await readFile(path.join(downloads, event.guid))).equals(bytes) } catch { return false } }, 'downloaded media bytes', 30000)
    assert.equal(await evaluate('location.pathname'), '/chat/user', 'download preserves the conversation')
  }
  // Downloading must never materialize the file as an object URL. File
  // selection/ThumbHash setup happened earlier and legitimately uses Blobs.
  await evaluate('(() => { const original = URL.createObjectURL; window.restoreDownloadObjectURL = () => { URL.createObjectURL = original }; URL.createObjectURL = () => { throw new Error(\'Unexpected download Blob\') }; })()')
  try {
    const clean = tags => tags.filter(tag => !['download', 'q'].includes(tag[0]))
    const imageRow = await insert('Download-only image', [...clean(photo.tags), ['download']])
    await browser.until(() => evaluate(`(${imageRow}).querySelector('.download-media img:not(.attachment-placeholder)')?.naturalWidth === 1`), 'download image remains visible')
    await download(`(${imageRow}).querySelector('a.download-media')`, 'photo.png', png)
    console.log('Download intent: image thumbnail verified')

    await evaluate(`(${imageRow}).querySelector('.chat-bubble').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}))`)
    await browser.until(() => evaluate('!!document.querySelector(".message-actions [aria-label=Reply]")'), 'download image reply menu')
    await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
    await browser.until(() => evaluate('document.querySelector(".composer-reply .reply-thumbnail")?.naturalWidth === 1'), 'download reply thumbnail')
    await download('document.querySelector(".composer-reply a.thumbnail-download")', 'photo.png', png)
    await evaluate('(() => { const input = document.querySelector(\'.chat-composer textarea\'); input.value = \'Reply to download image\'; input.dispatchEvent(new Event(\'input\', {bubbles:true})); })()')
    await browser.until(() => evaluate('!document.querySelector(".compose-action").disabled'), 'reply ready')
    await evaluate('document.querySelector(".compose-action").click()')
    const replyRow = '[...document.querySelectorAll(\'.message-row\')].find(row => row.querySelector(\'.chat-content\')?.textContent.includes(\'Reply to download image\'))'
    await browser.until(() => evaluate(`!!(${replyRow})`), 'reply saved')
    await reveal(replyRow)
    await browser.until(() => evaluate(`(${replyRow}).querySelector('.quote-thumbnail')?.naturalWidth === 1`), 'download quote thumbnail')
    await download(`(${replyRow}).querySelector('a.thumbnail-download')`, 'photo.png', png)
    console.log('Download intent: reply and quote verified')

    const videoRow = await insert('Download-only video', [...clean(videoTags), ['download', '1']])
    await browser.until(() => evaluate(`(${videoRow}).querySelector('video')?.videoWidth === 32`), 'download video preview')
    assert.deepEqual(await evaluate(`(() => { const v = (${videoRow}).querySelector('video'); return [v.controls,v.paused] })()`), [false, true])
    await download(`(${videoRow}).querySelector('a.download-media')`, 'clip.webm', Buffer.from(videoBytes))
    assert.equal(await evaluate(`(${videoRow}).querySelector('video').paused`), true)

    console.log('Download intent: video thumbnail verified')
    const playRow = await insert('Playable video', [...clean(videoTags), ['download', '0']])
    await browser.until(() => evaluate(`(${playRow}).querySelector('video')?.controls`), 'explicit zero keeps playback controls')
    assert.equal(await evaluate(`(${playRow}).querySelector('a.download-media')`), null)

    const source = photo.tags.find(tag => tag[0] === 'url')[1]
    // Inline metadata must reach the same renderer and be removed before
    // asking the launcher to prepare its strictly validated local route.
    const inlineRow = await insert(source + '#download=1', [], 9)
    await download(`(${inlineRow}).querySelector('a.download-media')`, 'photo.png', png)
    const externalRow = await insert('https://download.example.com/photo.png#download=1&m=application%2Foctet-stream', [], 9)
    await download(`(${externalRow}).querySelector('a.attachment-download')`, 'external.png', png, false)
    const externalImage = await insert('https://download.example.com/photo.png#download=1', [], 9)
    const label = `(${externalImage}).querySelector('.chat-media > a')`
    await download(label, 'external.png', png, false)
    assert.equal(await evaluate(`(${label}).rel`), '', 'noopener must not turn the named download target into a new tab')
    console.log('Attachments: download intent, replies, inline URLs and native external download verified')
  } finally { await evaluate('window.restoreDownloadObjectURL(); delete window.restoreDownloadObjectURL') }
}
