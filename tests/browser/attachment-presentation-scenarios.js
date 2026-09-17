import assert from 'node:assert/strict'
import { nfileDecode, nfileEncode, neventEncode } from 'libp2r2p/nip19'
import { getEventHash } from 'libp2r2p/event'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

export async function checkAttachmentPresentation ({ browser, evaluate, origin, select, url, bytes, downloads }) {
  const pageSession = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
  const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
  const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  const preview = () => evaluate(`(() => {
    const box = document.querySelector('.composer-attachment .chat-attachment');
    const parent = box.closest('.composer-attachment').getBoundingClientRect(); const rect = box.getBoundingClientRect();
    const remove = box.querySelector('.attachment-remove').getBoundingClientRect();
    return {width:rect.width,height:rect.height,cell:(parent.width-18)/4,inside:remove.right<=rect.right+.1 && remove.top>=rect.top-.1,
      name:box.querySelector('.file-name').getAttribute('aria-label'), size:box.querySelector('.attachment-size')?.textContent,
      category:box.dataset.category, fallback:!!box.querySelector('.attachment-fallback')};
  })()`)
  const inlineLines = selector => evaluate(`(() => {
    const root = ${selector}; const caption = root.querySelector('.file-caption');
    const range = document.createRange(); range.selectNodeContents(caption);
    const rows = new Map();
    for (const rect of range.getClientRects()) {
      if (rect.width <= 0) continue;
      const y = Math.round(rect.top * 10);
      rows.set(y, Math.min(rows.get(y) ?? Infinity, rect.left));
    }
    const lines = [...rows.values()];
    const left = root.getBoundingClientRect().left;
    const name = root.querySelector('.file-name').getBoundingClientRect();
    return {count:lines.length, firstAfterName:lines[0] >= name.right - 1,
      followingAtLeft:lines.slice(1).every(x => Math.abs(x-left)<1), offsets:lines.map(x => x-left)};
  })()`)
  try {
    await evaluate('document.querySelector(".cancel-reply")?.click()')
    for (const [filename, data, category] of [['audio.mp3', Buffer.from('no preview'), 'audio'], ['broken.png', Buffer.from('invalid image'), 'media'], ['notes.txt', Buffer.from('notes'), 'document']]) {
      await select(filename, data)
      await settle()
      const state = await preview()
      assert.equal(state.category, category)
      assert.equal(state.fallback, true)
      assert.ok(state.inside)
      if (filename === 'notes.txt') {
        await browser.until(() => evaluate('!document.querySelector(".attachment-label .file-name").hasAttribute("data-truncated")'), 'short filename keeps its extension dot')
        await browser.until(() => evaluate('document.querySelector(".attachment-label .file-label")?.textContent === "notes.txt"'), 'full label rendered')
        await evaluate('document.querySelector(".attachment-label").style.maxWidth="35px"')
        await browser.until(() => evaluate('document.querySelector(".attachment-label .file-name").hasAttribute("data-truncated")'), 'narrow filename suppresses the extension dot')
        await browser.until(() => evaluate('document.querySelector(".attachment-label .file-label")?.textContent.endsWith("…txt")'), 'fitted label rendered')
        await evaluate('document.querySelector(".attachment-label").style.maxWidth=""')
        await browser.until(() => evaluate('!document.querySelector(".attachment-label .file-name").hasAttribute("data-truncated")'), 'widening restores the extension dot without oscillation')
      }
      await evaluate('document.querySelector(".attachment-remove").click()')
    }
    const longName = 'report-' + 'wide-name-'.repeat(12) + '.pdf'
    await select(longName, Buffer.alloc(1500000, 1))
    for (const width of [320, 390, 1024]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: width < 500 }, pageSession)
      for (const theme of ['light', 'dark']) {
        await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, appSession)
        await settle()
        if (width === 390) {
          await mkdir('/tmp/zillion-attachment-review', { recursive: true })
          await writeFile(`/tmp/zillion-attachment-review/composer-${theme}.png`, Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, pageSession)).data, 'base64'))
        }
        const state = await preview()
        assert.ok(Math.abs(state.width - state.height) < 1 && Math.abs(state.width - state.cell) < 1, JSON.stringify(state))
        assert.equal(state.name, longName)
        await browser.until(() => evaluate('document.querySelector(".attachment-label .file-label")?.textContent.endsWith("…pdf")'), 'fitted label rendered')
        assert.equal(state.size, '1.5MB')
        const gap = await evaluate(`(() => {
          const label=document.querySelector('.attachment-label .file-label');
          const node=label.firstChild; const index=node.textContent.lastIndexOf('…');
          const ellipsis=document.createRange();ellipsis.setStart(node,index);ellipsis.setEnd(node,index+1);
          const extension=document.createRange();extension.setStart(node,index+1);extension.setEnd(node,index+2);
          return extension.getBoundingClientRect().left-ellipsis.getBoundingClientRect().right;
        })()`)
        assert.ok(Math.abs(gap) < 0.1, `ellipsis/extension gap: ${gap}`)
        assert.ok(state.inside)
        assert.equal(await evaluate('(() => { const name = document.querySelector(\'.attachment-label .file-name\'); const extension = name.querySelector(\'.file-label\'); return extension.getBoundingClientRect().right <= name.closest(\'.attachment-label\').getBoundingClientRect().right && name.scrollWidth <= name.clientWidth + 1; })()'), true)
      }
    }
    await evaluate('document.querySelector(".attachment-remove").focus()')
    assert.equal(await evaluate('document.activeElement.matches(".attachment-remove")'), true)
    await evaluate('document.querySelector(".attachment-remove").click()')
    // Small actual images exercise extreme ratios without allocating large decoded media.
    for (const [width, height] of [[1, 2048], [2048, 1]]) {
      const data = await evaluate(`(() => { const c=document.createElement('canvas'); c.width=${width}; c.height=${height}; c.getContext('2d').fillRect(0,0,c.width,c.height); return c.toDataURL('image/png').split(',')[1]; })()`)
      const filename = `ratio-${width}-${height}.png`
      await select(filename, Buffer.from(data, 'base64'))
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".attachment-preview .attachment-frame img:not(.attachment-placeholder)")).objectFit'), 'contain')
      await evaluate('document.querySelector(".compose-action").click()')
      const row = `[...document.querySelectorAll('.message-row')].find(row => row.querySelector('.file-name')?.getAttribute('aria-label') === '${filename}')`
      await browser.until(() => evaluate(`(${row})?.querySelector('.message-status')?.dataset.status === 'saved'`), 'extreme-ratio attachment saved')
      await evaluate(`document.querySelector('.chat-timeline').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true})); (${row}).scrollIntoView({block:'center'})`)
      await browser.until(() => evaluate(`(${row}).querySelector('img:not(.attachment-placeholder)')?.naturalWidth === ${Math.min(width, 320)}`), 'reduced extreme image decoded')
      await settle()
      const geometry = await evaluate(`(() => { const r=${row}; const frame=r.querySelector('.attachment-frame').getBoundingClientRect(); const card=r.querySelector('.chat-attachment').getBoundingClientRect(); const line=r.querySelector('.attachment-download').getBoundingClientRect(); return {width:frame.width,height:frame.height,card:card.width,line:line.width}; })()`)
      assert.ok(geometry.width >= 160 && geometry.width <= 320 && geometry.height <= 360)
      assert.ok(Math.abs(geometry.line - geometry.card) < 1 && Math.abs(geometry.width - geometry.card) < 1)
    }
    const reference = nfileDecode(new URL(url).pathname.slice('/~~nfile/'.length))
    const source = `https://nostr.alt/${nfileEncode({ root: reference.root, mime: 'application/pdf' })}?localOnly=1`
    const filename = reference.root + '.pdf'
    const caption = 'First line\nSecond line followed by enough words to wrap onto additional lines naturally.'
    const owner = await evaluate('selfChatAccount.pubkey$()')
    const at = Math.floor(Date.now() / 1000) + 1000
    const file = {
      kind: 1063, content: caption, created_at: at,
      tags: [['url', source], ['r', reference.root], ['m', 'application/pdf'], ['size', String(bytes.length)], ['service', 'irfs']]
    }
    const fileId = getEventHash({ ...file, pubkey: owner })
    const message = {
      kind: 9, created_at: at,
      content: `nostr:${neventEncode({ id: fileId, author: owner, kind: 1063 })}`,
      tags: [['q', fileId, '', owner]]
    }
    const context = `dm:${owner}`
    assert.equal(await evaluate(`(async () => (await window.napp.eventStore.addPersonalCopy(${JSON.stringify(file)}, {context:${JSON.stringify(context)}})).result.ok)()`), true)
    assert.equal(await evaluate(`(async () => (await window.napp.eventStore.addPersonalCopy(${JSON.stringify(message)}, {context:${JSON.stringify(context)}})).result.ok)()`), true)
    const row = `[...document.querySelectorAll('.message-row')].find(row => row.querySelector('.attachment-name')?.textContent.includes(${JSON.stringify(filename)}))`
    await browser.until(() => evaluate(`!!(${row})?.querySelector('.attachment-download[href]')`), 'received file gets a fallback download name')
    await browser.until(() => evaluate(`(${row})?.querySelector('.attachment-caption')?.textContent === ${JSON.stringify(caption)}`), 'received file caption renders below the download row')
    const href = await evaluate(`(${row}).querySelector('.attachment-download').href`)
    assert.equal(nfileDecode(new URL(href).pathname.slice('/~~nfile/'.length)).filename, filename)
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath: downloads, eventsEnabled: true })
    const count = browser.downloads.length
    await evaluate(`(${row}).querySelector('.attachment-download').click()`)
    const downloaded = await browser.until(() => browser.downloads.slice(count).find(event => event.method === 'Browser.downloadWillBegin'), 'derived nfile downloads natively')
    assert.equal(downloaded.suggestedFilename, filename)
    await browser.until(async () => { try { return (await readFile(path.join(downloads, downloaded.guid))).equals(bytes) } catch { return false } }, 'fallback download keeps exact offline bytes')
    await evaluate(`(${row}).querySelector('.chat-bubble').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`)
    await browser.until(() => evaluate('!!document.querySelector(".message-actions [aria-label=Reply]")'), 'unnamed document reply menu')
    await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
    await browser.until(() => evaluate('document.querySelector(".composer-reply .file-reply")?.innerText.includes("First line")'), 'composer reply shows filename and caption')
    assert.equal(await evaluate('document.querySelector(".composer-reply .file-caption").textContent'), ' ' + caption)
    const composedLines = await inlineLines('document.querySelector(".composer-reply .file-reply")')
    assert.ok(composedLines.count >= 2 && composedLines.firstAfterName && composedLines.followingAtLeft, JSON.stringify(composedLines))
    await evaluate('(() => {const input=document.querySelector(\'.chat-composer textarea\');input.value=\'Reply presentation\';input.dispatchEvent(new Event(\'input\',{bubbles:true}));document.querySelector(\'.compose-action\').click()})()')
    // Real bubbles keep the posted quote inside z-chat-content, so match the
    // row that contains the typed text and the quote instead of an exact text.
    const quote = '[...document.querySelectorAll(\'.message-row\')].find(row => row.querySelector(\'.chat-content\')?.innerText.includes(\'Reply presentation\') && row.querySelector(\'.message-quote\'))?.querySelector(\'.message-quote\')'
    await browser.until(() => evaluate(`(${quote})?.querySelector('.file-name')?.getAttribute('aria-label') === '${filename}'`), 'posted quote retains filename before caption')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 520, deviceScaleFactor: 1, mobile: true }, pageSession)
    await settle()
    assert.equal(await evaluate(`(() => {const q=${quote};const name=q.querySelector('.file-name').getBoundingClientRect(); const line=q.querySelector('.file-reply').getBoundingClientRect();return name.width<=line.width/2+1 && q.scrollWidth<=q.clientWidth+1})()`), true)
    const postedLines = await inlineLines(`(${quote}).querySelector('.file-reply')`)
    assert.ok(postedLines.count >= 3 && postedLines.firstAfterName && postedLines.followingAtLeft, JSON.stringify(postedLines))
    await evaluate('(() => {const t=document.querySelector(".chat-timeline");t.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true}));t.scrollTop=t.scrollHeight})()')
    await browser.until(() => evaluate('(() => {const t=document.querySelector(".chat-timeline");return t.scrollHeight-t.clientHeight-t.scrollTop<1})()'), 'following bottom after narrow viewport')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 700, deviceScaleFactor: 1, mobile: true }, pageSession)
    await browser.until(() => evaluate('(() => {const t=document.querySelector(".chat-timeline");return t.scrollHeight-t.clientHeight-t.scrollTop<1})()'), 'bottom follows keyboard-sized viewport change')
    const screenshots = '/tmp/zillion-attachment-review'
    await mkdir(screenshots, { recursive: true })
    await writeFile(path.join(screenshots, 'attachment-reply.png'), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, pageSession)).data, 'base64'))
    console.log('Attachments: responsive squares, overlays, extreme ratios, filenames, quotes and offline fallback download verified')
  } finally {
    await browser.send('Emulation.clearDeviceMetricsOverride', {}, pageSession)
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, appSession)
  }
}
