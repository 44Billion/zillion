import assert from 'node:assert/strict'

export async function checkGalleryFrames ({ browser, evaluate }) {
  await browser.until(() => evaluate('document.querySelector(".attachment-gallery button[title=\\"photo.png\\"] img")?.complete'), 'cached gallery preview')
  const result = await evaluate(`(async () => {
    const original = fetch; let reads = 0, blankFrames = 0, frames = 0; const samples = [];
    const source = document.querySelector('.attachment-gallery button[title="photo.png"] img').src;
    const workers = previewWorkerCount;
    window.fetch = (...args) => { if (String(args[0]).startsWith('https://nostr.alt/')) reads++; return original(...args); };
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const before = frames;
        document.querySelector('.chat-composer .attach').click();
        for (let frame = 0; frame < 3; frame++) await new Promise(resolve => requestAnimationFrame(resolve));
        document.querySelector('.chat-composer .attach').click();
        for (let frame = 0; frame < 12; frame++) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const tile = document.querySelector('.attachment-gallery button[title="photo.png"]');
          if (tile) { frames++; if (!tile.querySelector('img')?.complete || !tile.querySelector('img')?.naturalWidth || tile.querySelector('icon-file-text-shield')) blankFrames++; }
        }
        samples.push(frames - before);
      }
      const id = selfChatAccount.send('Gallery update stability');
      await selfChatAccount.retryMessage(id);
      for (let frame = 0; frame < 12; frame++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const tile = document.querySelector('.attachment-gallery button[title="photo.png"]');
        if (!tile?.querySelector('img')?.naturalWidth || tile.querySelector('icon-file-text-shield')) blankFrames++;
      }
      return { samples, reads, blankFrames, frames, workers: previewWorkerCount - workers,
        stable: document.querySelector('.attachment-gallery button[title="photo.png"] img')?.src === source };
    } finally { window.fetch = original; }
  })()`)
  console.log('Gallery frame sample:', result)
  assert.ok(result.frames >= 24)
  assert.ok(result.samples.every(count => count > 0))
  assert.deepEqual({ ...result, frames: 0, samples: [] }, { samples: [], reads: 0, blankFrames: 0, frames: 0, workers: 0, stable: true })
  console.log(`Gallery: ${result.frames} reopening frames preserve the cached preview without original reads`)
}

export async function checkGalleryRecovery ({ browser, evaluate, origin }) {
  const vault = expression => browser.evaluate(expression, 'http://localhost:4000')
  const lock = async () => {
    await vault('document.querySelector("vault-lock-button button").click()')
    await browser.until(() => vault('!!document.querySelector("lock-overlay .lock-unlock")'), 'vault locked before reopening')
  }
  const unlock = async () => {
    await vault('document.querySelector("lock-overlay .lock-unlock").click()')
    await browser.until(() => vault('!document.querySelector("vault-lock-button").hidden'), 'vault unlocked without restarting app')
  }
  const reload = async () => {
    const route = await evaluate('location.pathname')
    await browser.evaluate(`(() => { const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)}); const url = new URL(frame.src); url.pathname = ${JSON.stringify(route)}; frame.src = url.href; })()`)
    await browser.until(() => evaluate('selfChatAccount.historyState$() === "unavailable" && !!document.querySelector(".chat-composer")'), 'cold locked history unavailable', 60000)
  }
  await lock()
  await reload()
  await evaluate(`(() => {
    window.galleryLoadingCounts = [];
    window.galleryObserver = new MutationObserver(() => {
      const count = document.querySelectorAll('.gallery-placeholder').length;
      if (count) galleryLoadingCounts.push(count);
    });
    galleryObserver.observe(document.querySelector('.chat-composer'), {childList:true,subtree:true});
    document.querySelector('.chat-composer .attach').click();
  })()`)
  await browser.until(() => evaluate('!!document.querySelector(".gallery-retry")'), 'locked gallery offers Retry')
  assert.equal(await evaluate('document.querySelectorAll(".attachment-gallery button").length'), 2)
  assert.equal(await evaluate('document.querySelectorAll(".gallery-placeholder").length'), 0)
  assert.equal(await evaluate('document.querySelector(".gallery-retry > span").textContent.trim()'), 'Retry')
  assert.ok((await evaluate('galleryLoadingCounts')).includes(3), 'loading has three placeholders plus add-file')
  await evaluate('document.querySelector(".gallery-retry").click()')
  await browser.until(() => evaluate('selfChatAccount.historyState$() === "unavailable" && !!document.querySelector(".gallery-retry")'), 'persistent failure stays retryable')
  await unlock()
  await evaluate('document.querySelector(".gallery-retry").click()')
  await browser.until(() => evaluate('selfChatAccount.historyState$() === "loaded" && document.querySelectorAll(".attachment-gallery button").length === 3'), 'Retry recovers catalog without app restart', 60000)
  await evaluate('galleryObserver.disconnect(); document.querySelector(".chat-composer .attach").click()')
  await browser.until(() => evaluate('!document.querySelector(".attachment-gallery")'), 'recovered gallery closes')

  // Another cold start exercises clip recovery and closing before its result.
  await lock()
  await reload()
  await unlock()
  await evaluate(`(() => {
    document.querySelector('.chat-composer .attach').click();
    const recovery = selfChatAccount.recover();
    window.galleryRecoveryShared = recovery === selfChatAccount.recover();
    document.querySelector('.chat-composer .attach').click();
    return recovery;
  })()`)
  assert.equal(await evaluate('galleryRecoveryShared'), true)
  await browser.until(() => evaluate('selfChatAccount.historyState$() === "loaded"'), 'clip recovers after unlock', 60000)
  assert.equal(await evaluate('!!document.querySelector(".attachment-gallery")'), false, 'late completion never reopens a closed gallery')
  await evaluate('document.querySelector(".chat-composer .attach").click()')
  await browser.until(() => evaluate('document.querySelectorAll(".attachment-gallery button").length === 3'), 'known recovered catalog opens immediately')
  await evaluate('document.querySelector(".chat-composer .attach").click()')
  console.log('Gallery: locked startup, persistent failure, Retry, clip recovery and late close verified')
}

export async function checkGalleryUI ({ browser, evaluate, origin }) {
  await evaluate('selfChatFixture.galleryFixture$(true)')
  await browser.until(() => evaluate('!!document.querySelector(".gallery-fixture .attach")'), 'controlled gallery component')
  try {
    await evaluate('document.querySelector(".gallery-fixture").style.width = "390px"; document.querySelector(".gallery-fixture .attach").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".gallery-fixture .gallery-placeholder").length === 3'), 'three loading placeholders')
    assert.equal(await evaluate('document.querySelectorAll(".gallery-fixture .attachment-gallery > *:not(style)").length'), 4)
    assert.equal(await evaluate('document.querySelector(".gallery-fixture .attachment-gallery").getAttribute("aria-busy")'), 'true')
    const panelHeight = () => evaluate('document.querySelector(".gallery-fixture .attachment-gallery").getBoundingClientRect().height')
    const loadingHeight = await panelHeight()
    assert.equal(await evaluate('new Set([...document.querySelector(".gallery-fixture .attachment-gallery").children].map(item => item.getBoundingClientRect().top)).size'), 1, 'loading tiles occupy one row')
    let context
    for (const candidate of browser.contexts.values()) {
      if (candidate.origin !== origin || !candidate.auxData?.isDefault) continue
      const { result } = await browser.send('Runtime.evaluate', { expression: '!!document.querySelector(".gallery-fixture")', contextId: candidate.id, returnByValue: true }, candidate.sessionId)
      if (result.value) { context = candidate; break }
    }
    assert.ok(context)
    await browser.until(() => evaluate('document.querySelector(".gallery-fixture .attachment-gallery").getAnimations({subtree:true}).length === 3'), 'three running shimmer animations')
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, context.sessionId)
    await browser.until(() => evaluate('getComputedStyle(document.querySelector(".gallery-fixture .gallery-placeholder"), "::after").animationName === "none"'), 'static reduced-motion placeholders')
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, context.sessionId)
    await evaluate('galleryUI.settle("unavailable")')
    await browser.until(() => evaluate('!!document.querySelector(".gallery-fixture .gallery-retry")'), 'failure tile')
    assert.equal(await evaluate('document.querySelector(".gallery-fixture .attachment-gallery").innerText.trim()'), 'Retry')
    assert.equal(await panelHeight(), loadingHeight, 'failure keeps loading height')
    const launcher = [...browser.contexts.values()].find(item => item.origin === 'http://localhost:10000' && item.auxData?.isDefault)
    await browser.send('Page.bringToFront', {}, launcher.sessionId)
    await evaluate('window.focus(); document.querySelector(".gallery-fixture .gallery-retry").focus()')
    assert.equal(await evaluate('document.activeElement.matches(".gallery-fixture .gallery-retry")'), true)
    await evaluate(`(() => {
      window.galleryDwell = { started: null, elapsed: null };
      window.galleryDwellObserver = new MutationObserver(() => {
        const loading = document.querySelectorAll('.gallery-fixture .gallery-placeholder').length === 3;
        if (loading && galleryDwell.started === null) galleryDwell.started = performance.now();
        if (!loading && galleryDwell.started !== null && galleryDwell.elapsed === null) galleryDwell.elapsed = performance.now() - galleryDwell.started;
      });
      galleryDwellObserver.observe(document.querySelector('.gallery-fixture'), {childList:true,subtree:true});
    })()`)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' }, context.sessionId)
    await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 }, context.sessionId)
    await browser.until(() => evaluate('galleryUI.calls$() === 2'), 'keyboard Retry starts recovery')
    await browser.until(() => evaluate('document.querySelectorAll(".gallery-fixture .gallery-placeholder").length === 3'), 'retry renders the same loading row')
    assert.equal(await panelHeight(), loadingHeight, 'retry keeps failure height')
    await evaluate('galleryUI.settle("unavailable")')
    assert.equal(await evaluate('document.querySelectorAll(".gallery-fixture .gallery-placeholder").length'), 3, 'fast failure keeps shimmers')
    assert.equal(await evaluate('!!document.querySelector(".gallery-fixture .gallery-retry")'), false, 'Retry waits for minimum display time')
    await browser.until(() => evaluate('!!document.querySelector(".gallery-fixture .gallery-retry")'), 'minimum retry display completes')
    const elapsed = await evaluate('galleryDwell.elapsed')
    assert.ok(elapsed >= 2000, `shimmers remain mounted for at least two seconds: ${elapsed}ms`)
    await evaluate('galleryDwellObserver.disconnect(); document.querySelector(".gallery-fixture .gallery-retry").click()')
    await browser.until(() => evaluate('galleryUI.calls$() === 3 && document.querySelectorAll(".gallery-fixture .gallery-placeholder").length === 3'), 'retry after minimum display')
    const choosers = browser.fileChoosers.length
    await evaluate('galleryUI.settle("loaded")')
    await browser.until(() => evaluate('document.querySelectorAll(".gallery-fixture .attachment-gallery button").length === 1 && !document.querySelector(".gallery-fixture .gallery-placeholder")'), 'empty result leaves just add-file')
    assert.equal(browser.fileChoosers.length, choosers, 'empty asynchronous result never launches picker')
    await evaluate('document.querySelector(".gallery-fixture .attach").click()')
    await browser.until(() => evaluate('!document.querySelector(".gallery-fixture .attachment-gallery")'), 'empty panel closes')
    await evaluate('galleryUI.settle("unavailable"); document.querySelector(".gallery-fixture .attach").click()')
    await browser.until(() => evaluate('galleryUI.calls$() === 4'), 'reopening unavailable catalog retries')
    await evaluate('document.querySelector(".gallery-fixture .attach").click(); galleryUI.settle("loaded")')
    await browser.until(() => evaluate('!document.querySelector(".gallery-fixture .attachment-gallery")'), 'late empty result stays closed')
    await evaluate('new Promise(resolve => setTimeout(resolve, 2100))')
    assert.equal(await evaluate('!!document.querySelector(".gallery-fixture .attachment-gallery")'), false, 'expired hold never reopens panel')
    await checkGalleryGeometry({ browser, evaluate })
    await browser.send('Emulation.setCPUThrottlingRate', { rate: 20 }, context.sessionId)
    try { await checkGalleryGeometry({ browser, evaluate }) } finally { await browser.send('Emulation.setCPUThrottlingRate', { rate: 1 }, context.sessionId) }
    console.log('Gallery: two-second retry display, stable height, reduced motion, keyboard and empty result verified')
  } finally {
    await evaluate('window.galleryDwellObserver?.disconnect(); galleryUI.settle("loaded"); selfChatFixture.galleryFixture$(false)')
    await browser.until(() => evaluate('!document.querySelector(".gallery-fixture")'), 'controlled gallery disposed')
  }
}

async function checkGalleryGeometry ({ browser, evaluate }) {
  await evaluate('document.querySelector(".gallery-fixture").style.width = "718px"; galleryUI.seedGallery(8)')
  await evaluate('document.querySelector(".gallery-fixture .attach").click()')
  await browser.until(() => evaluate('document.querySelectorAll(".gallery-fixture .attachment-gallery img").length === 8 && [...document.querySelectorAll(".gallery-fixture .attachment-gallery img")].every(img => img.complete && img.naturalWidth)'), 'cached multirow gallery')
  const result = await evaluate(`(async () => {
    const frames = [], readyHeight = document.querySelector('.gallery-fixture .attachment-gallery').getBoundingClientRect().height;
    for (let cycle = 0; cycle < 3; cycle++) {
      document.querySelector('.gallery-fixture .attach').click();
      for (let n = 0; n < 6; n++) await new Promise(requestAnimationFrame);
      document.querySelector('.gallery-fixture .attach').click();
      for (let n = 0; n < 20; n++) {
        await new Promise(requestAnimationFrame);
        const gallery = document.querySelector('.gallery-fixture .attachment-gallery');
        if (gallery) frames.push({ cycle, height: gallery.getBoundingClientRect().height, images: gallery.querySelectorAll('img').length, buttons: gallery.querySelectorAll('button').length, scrollHeight: gallery.scrollHeight });
      }
    }
    return { readyHeight, frames };
  })()`)
  console.log('Gallery multirow frames:', { readyHeight: result.readyHeight, frames: result.frames.length, heights: [...new Set(result.frames.map(frame => frame.height))], imageCounts: [...new Set(result.frames.map(frame => frame.images))] })
  assert.equal(result.readyHeight, 230, 'second row is partially visible')
  assert.ok(result.frames.length >= 40)
  assert.ok(result.frames.every(frame => Math.abs(frame.height - result.readyHeight) < 1), 'gallery height is final from its first mounted frame')
  assert.ok(result.frames.every(frame => frame.images === 8), 'cached thumbnails never disappear during reopening')
  await evaluate('document.querySelector(".gallery-fixture .attach").click()')
  await browser.until(() => evaluate('!document.querySelector(".gallery-fixture .attachment-gallery")'), 'multirow gallery closes')
}
