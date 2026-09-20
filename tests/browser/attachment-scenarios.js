import assert from 'node:assert/strict'
import { nfileDecode, nfileEncode } from 'libp2r2p/nip19'
import { mkdtemp, mkdir, open, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { crc32 } from 'node:zlib'
import { createFileMetadata } from 'libp2r2p/nip94'
import { checkAttachmentPresentation } from './attachment-presentation-scenarios.js'
import { checkGalleryFrames, checkGalleryRecovery, checkGalleryUI } from './gallery-scenarios.js'
import { checkDownloadIntent } from './download-intent-scenarios.js'

// The whole suite runs inside one systemd memory cgroup. Reading its current
// charge at phase boundaries keeps the 3 GiB budget visible in the logs and
// makes a future regression obvious.
async function cgroupMemory () {
  try {
    const path = (await readFile('/proc/self/cgroup', 'utf8')).trim().split('\n').at(-1).split(':').at(-1)
    return Math.round(Number(await readFile(`/sys/fs/cgroup${path}/memory.current`, 'utf8')) / 1024 / 1024)
  } catch { return null }
}

export async function checkAttachmentScenarios ({ browser, evaluate, origin, requests = [] }) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'zillion-files-'))
  const trace = async label => console.log(`Attachments memory: ${label} ${await cgroupMemory() ?? '?'} MiB`)
  try {
    await trace('start')
    await evaluate('document.querySelector(".cancel-reply")?.click(); document.querySelector(".chat-timeline").scrollTop = 1e9')
    // Runtime contexts include the trusted iframe too; locate the actual input.
    const findInput = async () => {
      for (const candidate of browser.contexts.values()) {
        if (candidate.origin !== origin || !candidate.auxData?.isDefault) continue
        const result = await browser.send('Runtime.evaluate', { expression: 'document.querySelector(".chat-composer input[type=file]")', contextId: candidate.id }, candidate.sessionId)
        if (result.result.objectId && result.result.subtype !== 'null') return { objectId: result.result.objectId, sessionId: candidate.sessionId }
      }
      throw new Error('File picker input missing')
    }
    const select = async (filename, bytes) => {
      const file = path.join(directory, filename)
      await writeFile(file, bytes)
      const input = await findInput()
      try { await browser.send('DOM.setFileInputFiles', { files: [file], objectId: input.objectId }, input.sessionId) } finally { await browser.send('Runtime.releaseObject', { objectId: input.objectId }, input.sessionId) }
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await browser.until(() => evaluate('document.querySelector(".compose-action").getAttribute("aria-disabled") === "false" && !!document.querySelector(".composer-attachment .attachment-remove") && !document.querySelector(".preparing-file")'), 'attachment prepared', 30000)
    }
    await evaluate('window.previewWorkers = new Set(); window.previewWorkerCount = 0; window.NativePreviewWorker = Worker; window.Worker = class extends NativePreviewWorker { constructor(...args) { super(...args); previewWorkers.add(this); previewWorkerCount++ } terminate() { previewWorkers.delete(this); super.terminate() } }')
    const alpha = await readFile(new URL('./fixtures/media/vp9-alpha.webm', import.meta.url))
    await select('alpha-preview.webm', alpha)
    await browser.until(() => evaluate('document.querySelector(".composer-attachment img:not(.attachment-placeholder)")?.naturalWidth === 320'), 'MediaBunny alpha preview inside launcher')
    assert.ok(await evaluate('previewWorkerCount > 0'), 'MediaBunny alpha uses working blob Workers in launcher')
    assert.equal(await evaluate('previewWorkers.size'), 0, 'MediaBunny releases alpha workers')
    const temporarySource = await evaluate('document.querySelector(".composer-attachment img:not(.attachment-placeholder)").src')
    await evaluate('document.querySelector(".composer-attachment .attachment-remove").click()')
    assert.equal(await evaluate(`fetch(${JSON.stringify(temporarySource)}).then(() => false, () => true)`), true, 'removal revokes its temporary image URL')
    console.log('Attachments: MediaBunny Workers and temporary preview disposal verified inside launcher')
    await trace('media workers')
    const picker = await findInput()
    await browser.send('Runtime.releaseObject', { objectId: picker.objectId }, picker.sessionId)
    await browser.send('Page.setInterceptFileChooserDialog', { enabled: true }, picker.sessionId)
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => browser.fileChoosers.length > 0, 'paperclip opens native picker')
    assert.equal(browser.fileChoosers.at(-1).mode, 'selectSingle')
    const count = () => evaluate('document.querySelectorAll(".message-row").length')
    const before = await count()
    // A sparse fixture exercises cancellation without a file-sized RAM allocation.
    const largePath = path.join(directory, 'preparing.bin')
    const largeFile = await open(largePath, 'w')
    try { await largeFile.truncate(128 * 1024 * 1024) } finally { await largeFile.close() }
    await evaluate('(() => { const input = document.querySelector(\'.chat-composer textarea\'); input.value = \'Keep caption\'; input.dispatchEvent(new Event(\'input\', {bubbles:true})); })()')
    const preparingInput = await findInput()
    try { await browser.send('DOM.setFileInputFiles', { files: [largePath], objectId: preparingInput.objectId }, preparingInput.sessionId) } finally { await browser.send('Runtime.releaseObject', { objectId: preparingInput.objectId }, preparingInput.sessionId) }
    await browser.until(() => evaluate('!!document.querySelector(".preparing-cancel svg")'), 'preparation cancel control')
    const preparation = await evaluate(`(() => {
      const button = document.querySelector('.preparing-cancel');
      const label = document.querySelector('.preparing-file [role=status]');
      const rect = button.getBoundingClientRect(), text = label.getBoundingClientRect();
      const style = getComputedStyle(button);
      button.focus();
      return {width:rect.width,height:rect.height,radius:style.borderRadius,background:style.backgroundColor,
        gap:text.left-rect.right,centerDelta:Math.abs((rect.top+rect.bottom-text.top-text.bottom)/2),
        icon:button.querySelector('svg').getBoundingClientRect().width,
        focused:document.activeElement===button,disabled:document.querySelector('.compose-action').disabled};
    })()`)
    assert.equal(preparation.width, 24)
    assert.equal(preparation.height, 24)
    assert.equal(preparation.radius, '5px')
    assert.match(preparation.background, /^rgb\(/, 'cancel background is opaque')
    assert.equal(preparation.gap, 8)
    assert.ok(preparation.centerDelta < 1, 'cancel aligns with status text')
    assert.equal(preparation.icon, 16)
    assert.equal(preparation.focused, true)
    assert.equal(preparation.disabled, true)
    await evaluate('document.querySelector(".preparing-cancel").click()')
    await browser.until(() => evaluate('!document.querySelector(".preparing-file") && !document.querySelector(".composer-attachment")'), 'preparation canceled')
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Keep caption')
    assert.equal(await count(), before, 'canceled preparation does not send')
    await evaluate('(() => { const input = document.querySelector(\'.chat-composer textarea\'); input.value = \'\'; input.dispatchEvent(new Event(\'input\', {bubbles:true})); })()')
    console.log('Attachments: compact preparation control and cancellation verified')
    await trace('prepare cancel')
    const bytes = Buffer.alloc(102003, 37)
    await select('document.bin', bytes)
    assert.equal(await evaluate('document.querySelector("input[type=file]").multiple'), false)
    assert.equal(await count(), before, 'selection does not send')
    await evaluate('document.querySelector(".composer-attachment .attachment-remove").click()')
    assert.equal(await count(), before, 'removal does not send')
    await select('document.bin', bytes)
    await browser.until(() => evaluate('!document.querySelector(".compose-action").disabled'), 'file-only Send')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('!document.querySelector(".composer-attachment")'), 'outbox takes attachment ownership')
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row")].some(row => row.querySelector(".attachment-name")?.textContent.includes("document.bin") && row.querySelector(".message-status")?.dataset.status === "saved")'), 'local chunks and metadata saved', 60000)
    const url = await browser.until(() => evaluate('[...document.querySelectorAll(".message-row .attachment-download")].find(a => a.textContent.includes("document.bin"))?.getAttribute("href")'), 'native download URL')
    assert.ok(url.startsWith(origin + '/~~nfile/'))
    assert.ok(url.includes('localOnly=1'))
    const headers = await evaluate(`(async () => { const r = await fetch(${JSON.stringify(url)}, {method:'HEAD'}); return {status:r.status,length:r.headers.get('content-length'),disposition:r.headers.get('content-disposition'),sniff:r.headers.get('x-content-type-options')}; })()`)
    assert.equal(headers.status, 200)
    assert.equal(headers.length, String(bytes.length))
    assert.match(headers.disposition, /^attachment;.*document.bin/)
    assert.equal(headers.sniff, 'nosniff')
    const range = await evaluate(`(async () => { const r = await fetch(${JSON.stringify(url)}, {headers:{Range:'bytes=50999-51002'}}); return {status:r.status,bytes:[...new Uint8Array(await r.arrayBuffer())]}; })()`)
    assert.deepEqual(range, { status: 206, bytes: [37, 37, 37, 37] })
    const downloads = path.join(directory, 'downloads')
    await mkdir(downloads)
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
    await evaluate('[...document.querySelectorAll(".message-row .attachment-download")].find(a => a.textContent.includes("document.bin")).click()')
    await browser.until(async () => { try { return (await readFile(path.join(downloads, 'document.bin'))).equals(bytes) } catch { return false } }, 'real Chrome download has correct bytes and name', 30000)
    console.log('Attachments: native download verified')
    await trace('binary download')
    await evaluate(`(() => {
      const original = window.fetch; window.fileReplyReads = 0;
      window.restoreFileReplyFetch = () => { window.fetch = original; };
      window.fetch = (...args) => { if (String(args[0]).startsWith('https://nostr.alt/')) window.fileReplyReads++; return original(...args); };
      [...document.querySelectorAll('.message-row')].find(row => row.querySelector('.attachment-name')?.textContent.includes('document.bin')).querySelector('.chat-bubble').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}));
    })()`)
    try {
      await browser.until(() => evaluate('!!document.querySelector(".message-actions [aria-label=Reply]")'), 'binary file reply menu')
      await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
      await browser.until(() => evaluate('document.querySelector(".composer-reply")?.textContent.includes("document.bin")'), 'binary file reply uses filename')
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assert.equal(await evaluate('window.fileReplyReads'), 0, 'binary reply does not fetch the document as a web preview')
      assert.equal(await evaluate('document.querySelector(".composer-reply .reply-text").innerText'), 'document.bin', 'caption-less file reply shows only the filename')
      assert.equal(await evaluate('document.querySelector(".composer-reply .reply-text").textContent.includes("nevent1")'), false, 'caption-less file reply does not surface the inline reference')
      assert.equal(await evaluate('document.querySelector(".composer-reply .reply-text").title'), '', 'caption-less file reply does not surface the inline reference')
      await evaluate('document.querySelector(".cancel-reply").click()')
    } finally { await evaluate('window.restoreFileReplyFetch(); delete window.restoreFileReplyFetch; delete window.fileReplyReads') }
    // Local misses and stale instance markers must never select another bridge.
    const missingSource = `https://nostr.alt/${nfileEncode({ root: 'ef'.repeat(32), mime: 'application/octet-stream', filename: 'missing.bin' })}?localOnly=1`
    const missing = await evaluate(`window.napp.getFileDownloadUrl(${JSON.stringify(missingSource)})`)
    assert.equal(await evaluate(`fetch(${JSON.stringify(missing)}, {method:'HEAD'}).then(r => r.status)`), 404)
    const wrongBridge = new URL(url)
    wrongBridge.searchParams.set('~~bridgeId', 'closed-instance')
    assert.equal(await evaluate(`fetch(${JSON.stringify(wrongBridge.href)}, {method:'HEAD'}).then(r => r.status)`), 404)
    console.log('Attachments: local miss and wrong bridge verified')
    await trace('local miss')
    const context = [...browser.contexts.values()].find(item => item.origin === 'http://localhost:10000' && item.auxData?.isDefault)
    await browser.send('ServiceWorker.enable', {}, context.sessionId)
    const worker = await browser.until(() => [...browser.workerVersions.values()].find(worker => worker.scriptURL === origin + '/sw.js' && worker.status === 'activated' && worker.runningStatus === 'running'), 'active app worker')
    await browser.send('ServiceWorker.stopWorker', { versionId: worker.versionId }, context.sessionId)
    const recovered = await evaluate(`fetch(${JSON.stringify(url)}, {method:'HEAD', signal:AbortSignal.timeout(12000)}).then(r => r.status).catch(e => e.message)`)
    assert.equal(recovered, 200, 'download recovers its exact bridge after a worker restart')
    console.log('Attachments: worker restart verified')
    await trace('worker restart')
    await evaluate(`(async () => { const response = await fetch(${JSON.stringify(url)}); const reader = response.body.getReader(); await reader.read(); await reader.cancel(); })()`)
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=', 'base64')
    for (let offset = 8; offset < png.length;) {
      const length = png.readUInt32BE(offset)
      png.writeUInt32BE(crc32(png.subarray(offset + 4, offset + 8 + length)), offset + 8 + length)
      offset += length + 12
    }
    await select('photo.png', png)
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row")].some(row => row.querySelector(".attachment-name")?.textContent.includes("photo.png") && row.querySelector(".message-status")?.dataset.status === "saved")'), 'image saved', 60000)
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row .attachment-frame img")].some(img => img.src.startsWith("blob:") && img.naturalWidth === 1)'), 'local image rendered without HTTP cache')
    const photoId = await evaluate('[...document.querySelectorAll(".message-row")].find(row => row.querySelector(".attachment-name")?.textContent.includes("photo.png")).dataset.messageId')
    await evaluate(`document.querySelector('[data-message-id="${photoId}"] .attachment-frame').click()`)
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .viewer-asset img")?.naturalWidth === 1'), 'original local image in viewer')
    assert.equal(await evaluate('new URL(document.querySelector(".route-page[data-active=true] .viewer-asset img").src).origin'), 'https://nostr.alt', 'viewer reads the original virtual file, not its blob thumbnail')
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape",bubbles:true}))')
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .chat-screen") && !document.querySelector("[data-transitioning]")'), 'return from local image viewer')
    await evaluate(`document.querySelector('[data-message-id="${photoId}"] .chat-bubble').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}))`)
    await browser.until(() => evaluate('!!document.querySelector(".message-actions [aria-label=Reply]")'), 'file reply menu')
    await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
    await browser.until(() => evaluate('document.querySelector(".composer-reply .reply-thumbnail")?.naturalWidth === 1'), 'file reply thumbnail')
    await evaluate(`(() => { const input = document.querySelector('.chat-composer textarea'); input.value = ${JSON.stringify('  Caption   file\n\n\nx  ')}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('document.querySelector(".composer-reply")?.querySelector(".reply-thumbnail")?.naturalWidth === 1'), 'reply thumbnail before the gallery')
    await browser.until(() => evaluate('document.querySelectorAll(".attachment-gallery button").length === 2'), 'gallery contains picker and one image')
    await checkGalleryFrames({ browser, evaluate, origin })
    assert.equal(await evaluate('previewWorkers.size'), 0, 'gallery/replies reuse completed thumbnails')
    assert.equal(await evaluate('document.querySelector(".chat-composer .attach").getAttribute("aria-expanded")'), 'true')
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('document.querySelector(".chat-composer .attach").getAttribute("aria-expanded") === "false" && !document.querySelector(".attachment-gallery")'), 'paperclip closes gallery')
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".attachment-gallery button").length === 2'), 'gallery reopened')
    await browser.until(() => evaluate('(() => { const button = document.querySelectorAll(".attachment-gallery button")[1]; if (!button) return false; button.click(); return true; })()'), 'select mounted gallery tile')
    assert.equal(await evaluate('!!document.querySelector(".composer-reply") && document.querySelector(".chat-composer textarea").value.includes("Caption")'), true, 'selection preserves caption and reply')
    await browser.until(() => evaluate('!!document.querySelector(".composer-attachment .attachment-remove")'), 'reused attachment rendered')
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('!!document.querySelector(".attachment-gallery")'), 'gallery opens alongside selected attachment')
    assert.deepEqual(await evaluate('[...document.querySelector(".chat-composer").children].filter(el => ["composer-reply","composer-attachment","attachment-gallery"].includes(el.className)).map(el => el.className)'), ['composer-reply', 'composer-attachment', 'attachment-gallery'])
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('!document.querySelector(".attachment-gallery")'), 'gallery closed before sending')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row")].filter(row => row.querySelector(".attachment-name")?.textContent.includes("photo.png") && row.querySelector(".message-status")?.dataset.status === "saved").length === 2'), 'reuse saved', 60000)
    // Reply with an image: the single break between the two URIs must not
    // paint as a blank line between the quote and the attachment.
    const imageReply = `[...document.querySelectorAll('.message-row')]
      .filter(row => row.querySelector('.attachment-name')?.textContent.includes(${JSON.stringify('photo.png')})).at(-1)`
    await browser.until(() => evaluate(`!!(${imageReply})?.querySelector('.message-quote') && !!(${imageReply})?.querySelector('.chat-attachment')`), 'image reply renders quote and attachment')
    const replyGap = await evaluate(`(() => { const row = ${imageReply}; const quote = row.querySelector('.message-quote').getBoundingClientRect(); const file = row.querySelector('.chat-attachment').getBoundingClientRect(); return file.top - quote.bottom; })()`)
    assert.ok(replyGap >= 0 && replyGap < 16, `structural break stays flush: ${replyGap}px`)
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".attachment-gallery button").length === 2'), 'gallery deduplicates roots')
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
    assert.equal(requests.some(url => url.startsWith('https://nostr.alt/')), false, 'local files never reach the external network')
    // The stored 9+1063 shapes (caption only on the 1063, two q tags, two URIs)
    // are asserted by tests/self-chat.test.js; here the presentation that
    // depends on those shapes is what matters.
    // The caption clamps to two lines and reveals two more per click.
    const captionText = 'Caption line one with enough words to wrap\nline two keeps going\nline three stays hidden\nline four stays hidden\nline five stays hidden'
    await select('captioned.png', png)
    await evaluate(`(() => { const input = document.querySelector('.chat-composer textarea'); input.value = ${JSON.stringify(captionText)}; input.dispatchEvent(new Event('input', {bubbles:true})); })()`)
    await evaluate('document.querySelector(".compose-action").click()')
    const captioned = `[...document.querySelectorAll('.message-row')].find(row =>
      row.querySelector('.attachment-name')?.textContent.includes('captioned.png') &&
      row.querySelector('.attachment-caption'))`
    await browser.until(() => evaluate(`(${captioned})?.querySelector('.message-status')?.dataset.status === 'saved'`), 'captioned image saved', 60000)
    const captionState = `(() => { const el = (${captioned}).querySelector('.attachment-caption'); const size = (${captioned}).querySelector('.attachment-size'); const text = (${captioned}).querySelector('.attachment-name'); return { clamp: getComputedStyle(el).webkitLineClamp, italic: getComputedStyle(el).fontStyle, muted: getComputedStyle(el).color === getComputedStyle(size).color, smaller: parseFloat(getComputedStyle(el).fontSize) < parseFloat(getComputedStyle(text).fontSize), expanded: el.getAttribute('aria-expanded') } })()`
    assert.deepEqual(await evaluate(captionState), { clamp: '2', italic: 'italic', muted: true, smaller: true, expanded: 'false' })
    await evaluate(`(() => { const button = (${captioned}).querySelector('.attachment-caption'); button.scrollIntoView({block:'center'}); button.click(); })()`)
    await browser.until(() => evaluate(`(${captioned}).querySelector('.attachment-caption').getAttribute('aria-expanded') === 'true'`), 'caption expands on click')
    assert.equal(await evaluate(`(${captioned}).querySelector('.attachment-caption').getAttribute('aria-expanded')`), 'true')
    assert.equal(await evaluate(`getComputedStyle((${captioned}).querySelector('.attachment-caption')).webkitLineClamp`), '4', 'each click reveals two more lines')
    await evaluate(`(${captioned}).querySelector('.attachment-caption').click()`)
    assert.equal(await evaluate(`(${captioned}).querySelector('.attachment-caption').getAttribute('aria-expanded')`), 'true', 'the caption expands until it is complete')
    console.log('Attachments: gallery, caption and reply verified')
    await trace('gallery frames')
    const vault = expression => browser.evaluate(expression, 'http://localhost:4000')
    await browser.until(() => vault('document.querySelectorAll("activity-log tr[data-row]").length > 0'), 'vault audit rows')
    assert.equal(await vault('[...document.querySelectorAll("activity-log .data-full")].reduce((n, pre) => n + pre.textContent.length, 0)'), 0, 'collapsed audit rows do not duplicate complete JSON')
    await vault('document.querySelector("activity-log details").open = true')
    await browser.until(() => vault('!!document.querySelector("activity-log details[open] .data-full").textContent'), 'audit details materialized on demand')
    assert.equal(await vault('typeof JSON.parse(document.querySelector("activity-log details[open] .data-full").textContent).method'), 'string', 'full audit record remains available')
    await vault('document.querySelector("activity-log details[open]").open = false')
    await browser.until(() => vault('[...document.querySelectorAll("activity-log .data-full")].every(pre => !pre.textContent)'), 'closing audit details releases their JSON')
    console.log('Attachments: vault audit JSON stays lazy')
    await trace('vault audit')
    const videoBytes = await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 16;
      const context = canvas.getContext('2d'); context.fillStyle = 'green'; context.fillRect(0, 0, 32, 16);
      const stream = canvas.captureStream(10);
      try {
        const recorder = new MediaRecorder(stream, {mimeType:'video/webm;codecs=vp8'});
        const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
        const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = reject; });
        recorder.start(); stream.getVideoTracks()[0].requestFrame();
        setTimeout(() => recorder.stop(), 350); await stopped;
        return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
      } finally { stream.getTracks().forEach(track => track.stop()); }
    })()`)
    await select('clip.webm', Buffer.from(videoBytes))
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row")].some(row => row.querySelector(".attachment-name")?.textContent.includes("clip.webm") && row.querySelector(".message-status")?.dataset.status === "saved")'), 'local video saved', 60000)
    // Equal-second IDs can sort a new send above a tall image. Only visible
    // attachments prepare their playback element, so bring the video into view.
    await evaluate('document.querySelector(".chat-timeline").dispatchEvent(new WheelEvent("wheel", {deltaY:-100,bubbles:true})); [...document.querySelectorAll(".message-row")].find(row => row.querySelector(".attachment-name")?.textContent.includes("clip.webm")).scrollIntoView({block:"center"})')
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row video")].some(video => video.poster.startsWith("blob:") && video.preload === "none")'), 'local video uses a prepared poster')
    assert.equal(await evaluate('[...document.querySelectorAll(".message-row video")].find(video => video.poster.startsWith("blob:")).readyState'), 0, 'video does not decode again before playback')
    await evaluate('void [...document.querySelectorAll(".message-row video")].find(video => video.poster.startsWith("blob:")).play().catch(() => {})')
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row video")].some(video => video.videoWidth === 32)'), 'user playback still decodes local video')
    await evaluate('document.querySelectorAll(".message-row video").forEach(video => video.pause())')
    await evaluate('[...document.querySelectorAll(".message-row")].find(row => row.querySelector(".attachment-name")?.textContent.includes("clip.webm")).querySelector(".media-expand").click()')
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .viewer-asset video")?.videoWidth === 32'), 'original local video in viewer')
    await evaluate('document.querySelector(".route-page[data-active=true] .viewer-close").click()')
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .chat-screen") && !document.querySelector("[data-transitioning]")'), 'return from local video viewer')
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".attachment-gallery button").length === 3'), 'gallery includes image and video')
    assert.equal(await evaluate('document.querySelectorAll(".attachment-gallery button")[1].getAttribute("title")'), 'clip.webm', 'latest media is first')
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
    const videoTags = await evaluate('(async () => { const owner = await window.nostr.peekPublicKey(); const {results} = await window.napp.eventStore.query({kinds:[1006], \'#k\':[\'1063\']}); const events = await Promise.all(results.map(async event => JSON.parse(new TextDecoder().decode(await window.nostr.nip44v3.decrypt(owner,1063,\'\',event.content))))); return events.find(event => event.tags.some(tag => tag[0] === \'m\' && tag[1] === \'video/webm\')).tags; })()')
    assert.ok(videoTags.some(tag => tag[0] === 'thumbhash'))
    assert.ok(videoTags.some(tag => tag[0] === 'dim' && tag[1] === '32x16'))
    console.log('Attachments: video preview and gallery order verified')
    await trace('video preview')
    await select('locked.wav', await readFile(new URL('./fixtures/media/compression.wav', import.meta.url)))
    await browser.until(() => evaluate('document.querySelector(".composer-attachment .file-name")?.getAttribute("title") === "locked.mp3"'), 'official MP3 encoder runs in launcher')
    const workersBeforeRetry = await evaluate('previewWorkerCount')
    await browser.evaluate('document.querySelector("vault-lock-button button").click()', 'http://localhost:4000')
    await browser.until(() => browser.evaluate('!!document.querySelector("lock-overlay .lock-unlock")', 'http://localhost:4000'), 'vault locked')
    await evaluate('document.querySelector(".compose-action").click()')
    const failedId = await browser.until(() => evaluate('[...document.querySelectorAll(".message-row")].find(row => row.querySelector(".attachment-name")?.textContent.includes("locked.mp3") && row.querySelector(".message-status")?.dataset.status === "error")?.dataset.messageId'), 'file outbox error with locked vault')
    await evaluate('selfChatAccount.recover()')
    assert.equal(await evaluate(`selfChatAccount.messages$().find(message => message.id === ${JSON.stringify(failedId)})?.status`), 'error', 'history recovery preserves failed attachment outbox')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', 'http://localhost:4000')
    await browser.until(() => browser.evaluate('!document.querySelector("vault-lock-button").hidden', 'http://localhost:4000'), 'vault unlocked for retry')
    await evaluate('document.querySelector(".chat-date .retry-btn").click()')
    await browser.until(() => evaluate('selfChatAccount.historyState$() === "loaded"'), 'conversation Retry restores history')
    await evaluate(`document.querySelector('[data-message-id="${failedId}"] .chat-bubble').dispatchEvent(new MouseEvent('contextmenu', {bubbles:true,cancelable:true}))`)
    await browser.until(() => evaluate('!!document.querySelector(".message-actions .message-retry")'), 'file retry menu')
    await evaluate('document.querySelector(".message-actions .message-retry").click()')
    await browser.until(() => evaluate(`document.querySelector('[data-message-id="${failedId}"] .message-status')?.dataset.status === 'saved'`), 'same file event saved after unlock')
    assert.equal(await evaluate('previewWorkerCount'), workersBeforeRetry, 'retry reuses compression and preview')
    const compressedUrl = await browser.until(() => evaluate('[...document.querySelectorAll(\'.attachment-download\')].find(a => a.textContent.includes(\'locked.mp3\'))?.href'), 'compressed download link')
    const compressedBytes = await evaluate(`fetch(${JSON.stringify(compressedUrl)}).then(r => r.arrayBuffer()).then(b => [...new Uint8Array(b)])`)
    assert.ok(compressedBytes.length < 384078)
    await evaluate('[...document.querySelectorAll(\'.attachment-download\')].find(a => a.textContent.includes(\'locked.mp3\')).click()')
    await browser.until(async () => { try { return (await readFile(path.join(downloads, 'locked.mp3'))).equals(Buffer.from(compressedBytes)) } catch { return false } }, 'compressed native download matches final bytes')
    await browser.until(() => evaluate('navigator.storage.getDirectory().then(root => root.getDirectoryHandle(\'zillion-compression-v1\')).then(dir => Array.fromAsync(dir.keys())).then(names => names.length === 0)'), 'confirmed artifact released')
    console.log('Attachments: compressed MP3, locked-vault retry and native download verified')
    await trace('locked vault retry')
    await checkGalleryRecovery({ browser, evaluate, origin })
    await trace('gallery recovery')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-composer").length === 1 && [...document.querySelectorAll(".message-row")].filter(row => row.querySelector(".attachment-name")?.textContent.includes("photo.png") && row.querySelector(".message-status")?.dataset.status === "saved").length === 2'), 'confirmed file metadata reopens offline', 60000)
    await browser.until(() => evaluate('[...document.querySelectorAll(".message-row .attachment-frame img")].some(img => img.src.startsWith("blob:") && img.naturalWidth === 1)'), 'image bytes survive reload offline')
    assert.deepEqual(await evaluate(`fetch(${JSON.stringify(compressedUrl)}).then(r => r.arrayBuffer()).then(b => [...new Uint8Array(b)])`), compressedBytes, 'compressed bytes reopen offline')
    await browser.until(() => evaluate('document.querySelector(".chat-timeline").dataset.historyLoaded === "true"'), 'complete history processed after file reload')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    // Rebuild the photo's nip94 tags from its live local download link; the
    // stored shape assertions live in tests/self-chat.test.js.
    const photoLink = await evaluate(`[...document.querySelectorAll('.message-row .attachment-download')]
      .find(a => a.textContent.includes(${JSON.stringify('photo.png')}))?.href`)
    assert.ok(photoLink, 'photo download link is rendered')
    const photoRoot = nfileDecode(new URL(photoLink).pathname.slice('/~~nfile/'.length)).root
    const photo = createFileMetadata({
      url: `https://nostr.alt/${nfileEncode({ root: photoRoot, mime: 'image/png', filename: 'photo.png' })}?localOnly=1`,
      mime: 'image/png', root: photoRoot, size: String(png.length), width: 1, height: 1, caption: 'Photo'
    })
    // Drop the DOM/heap accumulated by the earlier phases (previews, audit rows,
    // downloads) before the download fixtures; the guarded run must stay well
    // below the 3 GiB cgroup cap.
    await browser.evaluate(`(() => {
      const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)})
      frame.src = new URL(frame.src).href
    })()`)
    await browser.until(() => evaluate('!!document.querySelector(".chat-composer") && document.querySelector(".chat-timeline")?.dataset.historyLoaded === "true"'), 'fresh app heap before download fixtures', 60000)
    await trace('reloaded before download intent')
    await checkDownloadIntent({ browser, evaluate, origin, downloads, photo, videoTags, png, videoBytes })
    await trace('download intent')
    await checkAttachmentPresentation({ browser, evaluate, origin, select, url, bytes, downloads, directory })
    await trace('attachment presentation')
    for (const [name, extension] of [['compression-rotated.jpg', 'jpg'], ['compression.gif', 'webp'], ['compression.mp4', 'mp4']]) {
      await select(name, await readFile(new URL('./fixtures/media/' + name, import.meta.url)))
      await browser.until(() => evaluate(`document.querySelector('.composer-attachment .file-name')?.getAttribute('title')?.endsWith(${JSON.stringify(extension)})`), 'compressed filename in real launcher')
      assert.ok(await evaluate('navigator.storage.getDirectory().then(root => root.getDirectoryHandle(\'zillion-compression-v1\')).then(dir => Array.fromAsync(dir.keys())).then(names => names.length > 0)'), 'transformed file stays owned by composer')
      await evaluate('document.querySelector(".composer-attachment .attachment-remove").click()')
      await browser.until(() => evaluate('navigator.storage.getDirectory().then(root => root.getDirectoryHandle(\'zillion-compression-v1\')).then(dir => Array.fromAsync(dir.keys())).then(names => names.length === 0)'), 'removal releases compressed file')
    }
    console.log('Attachments: image, animation and H264 compression verified inside launcher')
    await trace('compression matrix')
    // Deleting the original message must remove its metadata only in the DM,
    // even though the catalog copy has the same inner ID. Reuse must create a
    // fresh metadata event instead of reviving the deleted one.
    const fileId = await evaluate(`selfChatAccount.messages$().find(message => message.id === ${JSON.stringify(photoId)}).tags.find(tag => tag[0] === 'q')[1]`)
    const copies = () => evaluate(`(async () => {
      const owner = await nostr.peekPublicKey();
      const mirror = await nostr.obfuscate(${JSON.stringify(fileId)}, '1006', '.id');
      return Promise.all(['dm:' + owner, ''].map(async context => {
        const c = await nostr.obfuscate(context, '1006', '');
        const {results} = await napp.eventStore.query({kinds:[1006], authors:[owner], '#k':['1063'], '#c':[c], '#o':[mirror], '#v':['0','1']});
        return results.length;
      }));
    })()`)
    assert.deepEqual(await copies(), [1, 1])
    assert.equal(await evaluate(`selfChatAccount.deleteMessage(${JSON.stringify(photoId)})`), true)
    assert.deepEqual(await copies(), [0, 1])
    await browser.until(() => evaluate(`!document.querySelector('[data-message-id="${photoId}"]')`), 'deleted photo leaves the timeline')
    await evaluate('document.querySelector(".chat-composer .attach").click()')
    await browser.until(() => evaluate('!!document.querySelector(".attachment-gallery button[title=\\"photo.png\\"]")'), 'catalog photo survives message deletion')
    await evaluate(`(() => {
      document.querySelector('.attachment-gallery button[title="photo.png"]').click();
      const input = document.querySelector('.chat-composer textarea');
      input.value = 'Reuse after deletion'; input.dispatchEvent(new Event('input', {bubbles:true}));
    })()`)
    await browser.until(() => evaluate('!!document.querySelector(".composer-attachment") && !document.querySelector(".compose-action").disabled'), 'catalog reuse ready')
    await evaluate('document.querySelector(".compose-action").click()')
    const reusedId = await browser.until(() => evaluate('[...document.querySelectorAll(\'.message-row\')].find(row => row.querySelector(\'.attachment-caption\')?.textContent.trim() === \'Reuse after deletion\' && row.querySelector(\'.message-status\')?.dataset.status === \'saved\')?.dataset.messageId'), 'catalog reuse saved after deletion', 60000)
    const reusedFileId = await evaluate(`selfChatAccount.messages$().find(message => message.id === ${JSON.stringify(reusedId)}).tags.findLast(tag => tag[0] === 'q')[1]`)
    assert.notEqual(reusedFileId, fileId)
    const catalogPhotoCount = await evaluate(`selfChatAccount.readFiles().then(events => events.filter(event => event.tags.some(tag => tag[0] === 'r' && tag[1] === ${JSON.stringify(photoRoot)})).length)`)
    assert.equal(catalogPhotoCount, 1, 'reuse never duplicates the catalog root')
    assert.deepEqual(await copies(), [0, 1], 'reuse does not revive deleted metadata')
    await browser.evaluate(`(() => {
      const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)});
      frame.src = new URL(frame.src).href;
    })()`)
    await browser.until(() => evaluate('selfChatAccount.historyState$() === "loaded" && !!document.querySelector(".chat-composer")'), 'deleted message stays absent after offline reload', 60000)
    assert.equal(await evaluate(`selfChatAccount.messages$().some(message => message.id === ${JSON.stringify(photoId)})`), false)
    assert.equal(await evaluate(`selfChatAccount.messages$().some(message => message.id === ${JSON.stringify(reusedId)})`), true)
    assert.deepEqual(await copies(), [0, 1])
    assert.equal(await evaluate(`fetch(${JSON.stringify(photo.tags.find(tag => tag[0] === 'url')[1])}, {method:'HEAD'}).then(response => response.status)`), 200, 'catalog keeps the photo bytes available offline')
    console.log('Attachments: scoped 9/1063 deletion, catalog retention, fresh reuse and offline reload verified')
    // The controlled gallery fixture is a separate guarded run
    // (`npm run test:browser:gallery-ui`) so no single unit approaches the cap.
    if (process.env.ZILLION_SKIP_GALLERY_UI !== '1') {
      await checkGalleryUI({ browser, evaluate, origin })
      await trace('gallery ui')
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}
