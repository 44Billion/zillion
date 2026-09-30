import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'

// Controlled coordinator notifications drive real attachment components and
// real stored nfile bytes; no signer, launcher or event-store API is replaced.
export async function checkTransferControls ({ browser, evaluate, id }) {
  const root = '.transfer-test-fixture'
  const button = `${root} .transfer-action`
  const image = `${root} .attachment-frame img:not(.attachment-placeholder)`
  const snapshot = async name => {
    await mkdir('tmp/browser-previews', { recursive: true })
    const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, browser.sessionId)
    await writeFile(`tmp/browser-previews/${name}.png`, Buffer.from(data, 'base64'))
  }
  const wait = (expression, label) => browser.until(() => evaluate(expression), label)
  await evaluate(`animationTest.showTransfer(${JSON.stringify(id)}, {size: undefined})`)
  await wait(`document.querySelector('${image}')?.src.startsWith('blob:')`, 'thumbnail before manual download')
  await wait(`!!document.querySelector('${root} .transfer-overlay')`, 'centered download overlay')
  assert.equal(await evaluate(`document.querySelector('${button}').getAttribute('aria-label')`), 'Download file')
  const geometry = await evaluate(`(() => {
    const b = document.querySelector('${button}').getBoundingClientRect();
    const f = document.querySelector('${root} .attachment-frame').getBoundingClientRect();
    return { dx: Math.abs(b.x+b.width/2-f.x-f.width/2), dy: Math.abs(b.y+b.height/2-f.y-f.height/2), width: b.width, radius: getComputedStyle(document.querySelector('${button}')).borderRadius };
  })()`)
  assert.ok(geometry.dx < 1 && geometry.dy < 1, JSON.stringify(geometry))
  assert.equal(geometry.width, 48)
  assert.equal(geometry.radius, '50%')
  await evaluate(`window.transferClicks = 0; document.querySelector('${root}').addEventListener('click', () => transferClicks++)`)
  for (const status of ['queued', 'starting', 'downloading']) {
    await evaluate(`animationTest.transfer({status: '${status}'})`)
    await wait(`document.querySelector('${root} .media-transfer')?.dataset.status === '${status}'`, status)
    assert.equal(await evaluate(`document.querySelector('${button}').getAttribute('aria-label')`), 'Cancel')
    assert.equal(await evaluate(`document.querySelector('${root} [role=progressbar]').hasAttribute('aria-valuenow')`), false, 'unknown total is indeterminate')
  }
  const origin = await evaluate('location.origin')
  const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
  await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, appSession)
  await wait(`getComputedStyle(document.querySelector('${root} .transfer-ring')).animationName === 'none'`, 'reduced motion stops spinner')
  await browser.send('Emulation.setEmulatedMedia', { features: [] }, appSession)
  for (const completed of [0, 25, 70, 100]) {
    await evaluate(`animationTest.transfer({status: 'downloading', completed: ${completed}, total: 100})`)
    await wait(`document.querySelector('${root} [role=progressbar]')?.getAttribute('aria-valuenow') === '${completed}'`, 'download progress')
    await wait(`document.querySelector('${root} .transfer-arc')?.getAttribute('stroke-dashoffset') === '${100 - completed}'`, 'ring progress')
    if (completed === 70) await snapshot('transfer-overlay')
  }
  assert.equal(await evaluate(`(() => { const b = document.querySelector('${button}'); const r = b.getBoundingClientRect(); return document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)?.closest('button') === b; })()`), true, 'progress SVG does not intercept the action')
  await evaluate(`document.querySelector('${button}').click()`)
  assert.equal(await evaluate('transferClicks'), 0, 'cancel does not open media or the bubble menu')
  for (const status of ['cancelled', 'paused', 'error']) {
    await evaluate(`animationTest.transfer({status: '${status}'})`)
    await wait(`document.querySelector('${root} .media-transfer')?.dataset.status === '${status}'`, status)
    assert.equal(await evaluate(`document.querySelector('${button}').getAttribute('aria-label')`), status === 'error' ? 'Retry' : 'Download file')
  }
  await evaluate("animationTest.transfer({status: 'complete', completed: 100, total: 100})")
  await wait(`document.querySelector('${image}')?.src.startsWith('https://nostr.alt/') && document.querySelector('${image}').naturalWidth > 0`, 'original replaces thumbnail without opening viewer')
  await wait(`!document.querySelector('${button}')`, 'complete transfer removes action overlay')
  await evaluate(`window.transferOriginal = document.querySelector('${image}'); animationTest.page.isActive$(false)`)
  await wait('!transferOriginal.hasAttribute("src")', 'inactive attachment releases original')
  await evaluate('animationTest.page.isActive$(true)')
  await wait(`document.querySelector('${image}')?.src.startsWith('https://nostr.alt/')`, 'original restored after activation')

  // Uploads use the same ring, then expose retry through the same action.
  await evaluate("animationTest.fixture.upload$({status:'pending', completed:40, total:100})")
  await wait(`document.querySelector('${root} [role=progressbar]')?.getAttribute('aria-label') === 'Uploading file'`, 'upload ring')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await evaluate(`document.querySelector('${button}').focus()`)
  assert.equal(await evaluate(`document.activeElement === document.querySelector('${button}')`), true, 'upload action receives focus')
  await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }, appSession)
  await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, appSession)
  await wait('animationTest.fixture.cancelCount$() === 1', 'keyboard cancels upload')
  await evaluate("animationTest.fixture.upload$({status:'error'})")
  await wait(`document.querySelector('${button}')?.getAttribute('aria-label') === 'Retry'`, 'upload retry')
  await evaluate(`document.querySelector('${button}').click()`)
  assert.equal(await evaluate('animationTest.fixture.retryCount$()'), 1)

  // No preview: keep filename/size and put the action before the progress bar.
  await evaluate('animationTest.fixture.upload$(null); animationTest.fixture.file$(null)')
  await wait(`!document.querySelector('${root} .chat-attachment')`, 'fixture unmounted')
  await evaluate(`animationTest.showTransfer(${JSON.stringify(id)}, {mime:'application/pdf', thumbhash:null, thumbnail:null})`)
  await evaluate("animationTest.transfer({status:'downloading', completed:30, total:100})")
  await wait(`!!document.querySelector('${root} .transfer-inline progress')`, 'document progress row')
  assert.ok(await evaluate(`(() => { const b=document.querySelector('${button}').getBoundingClientRect(); const p=document.querySelector('${root} progress').getBoundingClientRect(); return b.right <= p.left && p.width > 0; })()`))
  await evaluate("animationTest.fixture.upload$({status:'pending', completed:55, total:100})")
  await wait(`document.querySelector('${root} progress')?.getAttribute('aria-label') === 'Uploading file'`, 'document upload progress')
  assert.equal(await evaluate(`document.querySelector('${root} progress').value`), 55)
  await snapshot('transfer-document')
  await evaluate('animationTest.fixture.file$(null); animationTest.fixture.upload$(null)')
  await wait(`!document.querySelector('${root} .chat-attachment')`, 'document fixture unmounted')
  // An unavailable thumbnail must not prevent completion from upgrading a
  // ThumbHash-only preview. Give the fixture a separate presentation cache key.
  await evaluate(`animationTest.showTransfer(${JSON.stringify(id)}, {root:'b'.repeat(64), thumbnail:null})`)
  await wait(`!!document.querySelector('${root} .attachment-placeholder') && !!document.querySelector('${root} .transfer-overlay')`, 'ThumbHash-only download overlay')
  await evaluate("animationTest.transfer({status:'downloading', completed:0, total:100})")
  await wait(`document.querySelector('${root} [role=progressbar]')?.getAttribute('aria-valuenow') === '0'`, 'automatic download starts at zero')
  await evaluate("animationTest.transfer({status:'complete', completed:100, total:100})")
  await wait(`document.querySelector('${image}')?.src.startsWith('https://nostr.alt/') && document.querySelector('${image}').naturalWidth > 0`, 'original replaces ThumbHash without thumbnail')
  await evaluate('animationTest.fixture.file$(null)')
  await wait(`!document.querySelector('${root} .chat-attachment')`, 'fresh cached attachment mount')
  await evaluate(`window.cachedTransferControls = []; window.cachedTransferObserver = new MutationObserver(() => {
    for (const action of document.querySelectorAll('${root} .media-transfer')) cachedTransferControls.push(action.dataset.status);
  }); cachedTransferObserver.observe(document.querySelector('${root}'), {childList:true, subtree:true, attributes:true});`)
  await evaluate(`animationTest.showTransfer(${JSON.stringify(id)}, {}, 'checking')`)
  await wait(`!!document.querySelector('${root} .chat-attachment')`, 'cached attachment mounted while checking')
  for (const completed of [0, 50, 100]) {
    await evaluate(`animationTest.transfer({status:'checking', completed:${completed}, total:100})`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await evaluate(`!!document.querySelector('${button}')`), false, 'local checks never show download controls')
  }
  await evaluate("animationTest.transfer({status:'complete', completed:100, total:100})")
  await wait(`document.querySelector('${image}')?.src.startsWith('https://nostr.alt/') && document.querySelector('${image}').naturalWidth > 0`, 'cached original ready without download UI')
  await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.deepEqual(await evaluate('cachedTransferControls'), [], 'no transient download button or progress while reopening cached media')
  await evaluate('cachedTransferObserver.disconnect(); animationTest.fixture.file$(null)')
  console.log('Transfer controls and silent cached-media reopening verified')
}
