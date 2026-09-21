import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('media viewer routes, same-chat navigation, gestures, native controls and retained state', { timeout: 240000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  let inspectViewer
  const heldMedia = []
  let releaseHeldMedia = false
  let rejectNeighbor = true
  try {
    let files
    const options = buildOptions({ onEnd: result => { files = result } })
    options.sourcemap = false
    options.plugins.push({
      name: 'media-viewer-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/route-driver.js"\nimport "../../tests/browser/fixtures/media-viewer-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'media-viewer-test', name: 'Media viewer test' })
    const jpeg = (await readFile(path.join(root, 'tests/browser/fixtures/media/jpeg-orientation-1.jpg'))).toString('base64')
    const mp4 = (await readFile(path.join(root, 'tests/browser/fixtures/media/avc.mp4'))).toString('base64')
    browser = await launchChrome({
      intercept: request => {
        const url = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(url.hostname)) return null
        if (url.hostname === 'viewer.example.com') {
          if (url.pathname === '/flaky.jpg' && rejectNeighbor) return { responseCode: 503, responseHeaders: [], body: '' }
          const response = {
            responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: url.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: url.pathname.endsWith('.mp4') ? mp4 : jpeg
          }
          if (url.pathname === '/held.jpg' && !releaseHeldMedia) return new Promise(resolve => heldMedia.push(() => resolve(response)))
          return response
        }
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(url.hostname)) return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        return false
      }
    })
    permissions = setInterval(() => browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {}), 100)
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher ready')
    const vaultOrigin = 'http://localhost:4000'
    // The test account is imported through the real vault UI below.
    const secret = generateSecretKey()
    const pubkey = getPublicKey(secret)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("#toolbar-active-avatar-button"))'), 'launcher toolbar')
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("account-add input") && document.querySelector("#vault").style.visibility === "visible")', vaultOrigin), 'vault UI')
    const vaultContext = [...browser.contexts.values()].find(context => context.origin === vaultOrigin && context.auxData?.isDefault)
    await browser.send('WebAuthn.enable', { enableUI: false }, vaultContext.sessionId)
    await browser.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
        hasResidentKey: true, hasUserVerification: true, hasPrf: true,
        isUserVerified: true, automaticPresenceSimulation: true
      }
    }, vaultContext.sessionId)
    await browser.evaluate('document.querySelector("create-overlay .create-dismiss")?.click(); document.querySelector("#add-account-btn").click()', vaultOrigin)
    await browser.evaluate(`document.querySelector('account-add input').value = ${JSON.stringify(bytesToBase16(secret))}; document.querySelector('account-add form').requestSubmit()`, vaultOrigin)
    await browser.until(async () => {
      await browser.evaluate('document.querySelector("passkey-fallback-dialog [data-choice=local]")?.click()', vaultOrigin)
      return browser.evaluate(`Boolean(document.querySelector('account-avatar[pubkey="${pubkey}"]'))`, vaultOrigin)
    }, 'imported test account', 45000)

    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const url = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app frame')
    const origin = new URL(url).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    inspectViewer = () => evaluate(`(() => {
      const properties = element => {
        const css = getComputedStyle(element), rect = element.getBoundingClientRect();
        return { tag: element.tagName, class: element.className, hidden: element.hidden, display: css.display, visibility: css.visibility, opacity: css.opacity, contentVisibility: css.contentVisibility, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      };
      const slide = document.querySelector('.route-page[data-active=true] .viewer-slide');
      return { inline: slide?.style.cssText, animations: slide?.getAnimations().map(animation => ({ state: animation.playState, frames: animation.effect?.getKeyframes() })), url: location.href, assets: [...document.querySelectorAll('.route-page[data-active=true] .viewer-asset[data-current=true]')].map(asset => {
        const ancestors = []; for (let node = asset; node; node = node.parentElement) ancestors.push(properties(node));
        return { id: asset.dataset.mediaId, current: asset.dataset.current, loaded: asset.dataset.loaded, ancestors,
          media: [...asset.querySelectorAll('img, video')].map(element => ({ ...properties(element), source: element.getAttribute('src')?.slice(0, 250), complete: element.complete, naturalWidth: element.naturalWidth, readyState: element.readyState, error: element.error?.code, visible: element.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}) })) };
      }) };
    })()`)

    // Reloading the launcher also reloads the vault; unlock through its real UI.
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')

    await evaluate('window.viewerTest?.recover?.()')
    const active = '.route-page[data-active=true] '
    const click = async selector => {
      await ready(selector)
      await evaluate(`document.querySelector(${JSON.stringify(active + selector)}).click()`)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    const ready = selector => browser.until(() => evaluate(`(() => {
      const route = window.testNavigation?.route$();
      const page = document.querySelector('.route-page[data-active=true]');
      return route && page?.dataset.routeId === route.uid + ':' + route.url.pathname + route.url.search && Boolean(page.querySelector(${JSON.stringify(selector)})) && !document.querySelector('[data-transitioning]');
    })()`), selector)
    const push = async (url, selector) => { await evaluate(`testNavigation.pushState({}, '', ${JSON.stringify(url)})`); await ready(selector) }
    const frame = '.message-row[data-message-id=first] .media-frame'
    const selected = () => evaluate('decodeURIComponent(location.hash.slice(1))')
    const loaded = () => browser.until(() => evaluate(`(() => {
      const asset = document.querySelector('${active}.viewer-asset[data-current=true]');
      const media = asset?.querySelector('img:not([hidden]), video:not([hidden])');
      return asset && !asset.hidden && asset.dataset.loaded === 'true' && media?.hasAttribute('src') && media.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && (location.pathname.endsWith('/photo') || asset.dataset.mediaId === decodeURIComponent(location.hash.slice(1))) &&
        (media.tagName === 'IMG' ? media.complete && media.naturalWidth > 0 : media.readyState >= 2);
    })()`), 'full media visible and loaded')
    const swipe = async (dx, dy) => {
      await evaluate(`(() => {
        const stage = document.querySelector('${active}.viewer-stage');
        stage.setPointerCapture = () => {};
        stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX: 180, clientY: 300 }));
        stage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, isPrimary: true, pointerId: 1, button: 0, clientX: 180 + ${dx}, clientY: 300 + ${dy} }));
      })()`)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    await ready('.home')
    await browser.until(() => evaluate('Boolean(window.viewerTest)'), 'viewer test driver')
    await evaluate('viewerTest.seed().then(() => { window.noReload = true })')
    await push('/chat/user', '.chat-screen')
    await ready(frame + ' img')
    await evaluate(`(() => {
      const input = document.querySelector('${active}textarea'); input.value = 'Retained media draft'; input.dispatchEvent(new Event('input', { bubbles: true }));
      window.originalInput = input;
      const timeline = document.querySelector('${active}.chat-timeline'); timeline.scrollTop = 0; window.originalTimeline = timeline;
    })()`)
    const historyBefore = await evaluate('history.length')
    await click(frame)
    await ready('.media-viewer')
    await loaded()
    assert.equal(await selected(), 'first:0')
    assert.equal(await evaluate('location.pathname'), '/chat/user/media')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-header p').textContent`), '1 of 3')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-previous').disabled`), true)
    await click('.viewer-next')
    await loaded()
    assert.ok((await selected()).startsWith('file:'))
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-footer p').textContent`), 'A photograph from this conversation')
    await swipe(0, -100)
    await loaded()
    assert.equal(await selected(), 'video:0')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-next').disabled`), true)
    await swipe(-100, 0)
    assert.equal(await selected(), 'video:0')
    await evaluate(`window.fullVideo = document.querySelector('${active}.viewer-asset[data-current=true] video'); fullVideo.muted = true; fullVideo.play()`)
    await swipe(100, 0)
    await loaded()
    assert.equal(await evaluate('fullVideo.paused && !fullVideo.hasAttribute("src")'), true)
    await swipe(0, 100)
    await loaded()
    assert.equal(await selected(), 'first:0')
    assert.equal(await evaluate('history.length'), historyBefore + 1)
    await evaluate('testNavigation.back()')
    await ready('.chat-screen')
    assert.equal(await evaluate(`document.querySelector('${active}textarea') === originalInput && originalInput.value === 'Retained media draft'`), true)
    assert.ok(await evaluate('Math.abs(originalTimeline.scrollTop) < 2'))
    assert.equal(await evaluate('window.noReload'), true)

    // Video body opens the route; its bottom control strip keeps native behavior.
    const videoSelector = '.message-row[data-message-id=video] video'
    await ready(videoSelector)
    await evaluate(`(() => {
      const video = document.querySelector('${active}${videoSelector}'); video.scrollIntoView(); window.inlineVideo = video;
      const rect = video.getBoundingClientRect(); video.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1, clientX: rect.left + 20, clientY: rect.bottom - 15 }));
    })()`)
    assert.equal(await evaluate('location.pathname'), '/chat/user')
    await evaluate('(() => { const rect = inlineVideo.getBoundingClientRect(); inlineVideo.dispatchEvent(new MouseEvent(\'click\', { bubbles: true, detail: 1, clientX: rect.left + 20, clientY: rect.top + 20 })); })()')
    await ready('.media-viewer')
    await loaded()
    assert.equal(await selected(), 'video:0')
    assert.equal(await evaluate('inlineVideo.paused && !inlineVideo.hasAttribute("src")'), true)
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))')
    await ready('.chat-screen')
    await click('.message-row[data-message-id=video] .media-expand')
    await ready('.media-viewer')
    await click('.viewer-close')
    await ready('.chat-screen')

    await push('/profile/user', '.profile-screen')
    await click('button.profile-photo')
    await ready('.media-viewer')
    await loaded()
    assert.equal(await evaluate('location.pathname'), '/profile/user/photo')
    assert.equal(await evaluate(`document.querySelectorAll('${active}.viewer-next, ${active}.viewer-previous').length`), 0)
    await swipe(-100, 0)
    assert.equal(await evaluate('location.pathname'), '/profile/user/photo')
    await click('.viewer-close')
    await ready('.profile-screen')

    // A different chat cannot browse the self-chat collection.
    await push('/chat/daniel/media#first%3A0', '.media-viewer')
    assert.equal(await evaluate(`document.querySelectorAll('${active}.viewer-asset').length`), 0)
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.equal(await evaluate('location.pathname'), '/chat/daniel')

    let appContext
    for (const context of browser.contexts.values()) {
      if (context.origin !== origin || !context.auxData?.isDefault) continue
      const probe = await browser.send('Runtime.evaluate', { expression: 'Boolean(window.viewerTest)', contextId: context.id, returnByValue: true }, context.sessionId)
      if (probe.result.value) { appContext = context; break }
    }
    assert.ok(appContext)
    let appSession = appContext.sessionId
    const appNodes = async () => {
      // Renderer DOM counters also include the launcher's/vault's audit UI.
      // Inspect this app realm, releasing every debugger handle afterward.
      const objectGroup = 'viewer-memory-measurement'
      try {
        const prototype = await browser.send('Runtime.evaluate', { expression: 'Node.prototype', contextId: appContext.id, objectGroup }, appSession)
        const objects = await browser.send('Runtime.queryObjects', { prototypeObjectId: prototype.result.objectId, objectGroup }, appSession)
        const result = await browser.send('Runtime.callFunctionOn', {
          objectId: objects.objects.objectId, returnByValue: true,
          functionDeclaration: `function () { return this.reduce((out, node) => {
            try { if (node.ownerDocument !== document) return out } catch { return out }
            out.nodes++;
            if (!node.isConnected) out.detached++;
            if (node instanceof HTMLImageElement) { out.images++; if (node.hasAttribute('src')) out.sources++; }
            return out;
          }, { nodes: 0, detached: 0, images: 0, sources: 0 }); }`
        }, appSession)
        assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails))
        return result.result.value
      } finally { await browser.send('Runtime.releaseObjectGroup', { objectGroup }, appSession) }
    }
    await mkdir(path.join(root, 'tmp/media-viewer'), { recursive: true })
    for (const theme of ['light', 'dark']) {
      await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, appSession)
      for (const width of [320, 1000]) {
        await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: width < 718 }, session)
        await push('/chat/user/media#first%3A0', '.media-viewer')
        await loaded()
        const geometry = await evaluate(`(() => { const e = document.querySelector('${active}.media-viewer'); const r = e.getBoundingClientRect(); return { width: r.width, available: innerWidth, fits: e.scrollWidth <= e.clientWidth && e.scrollHeight <= e.clientHeight }; })()`)
        assert.equal(geometry.width, geometry.available)
        assert.equal(geometry.fits, true)
        const { data } = await browser.send('Page.captureScreenshot', { format: 'png' }, session)
        await writeFile(path.join(root, `tmp/media-viewer/${theme}-${width}.png`), Buffer.from(data, 'base64'))
      }
    }
    // Dispatch real touch input through Chrome, including vertical navigation.
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 }, session)
    const touchSwipe = async (dx, dy) => {
      await browser.until(() => evaluate(`document.querySelector('${active}.viewer-slide').getAnimations().every(animation => animation.playState !== 'running') && !document.querySelector('${active}.viewer-next')?.disabled`), 'settled touch target')
      const point = await evaluate(`(() => { const r = document.querySelector('${active}.viewer-stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)
      await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, session)
      for (let n = 1; n <= 4; n++) await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + dx * n / 4, y: point.y + dy * n / 4, id: 1 }] }, session)
      await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, session)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    await push('/chat/user/media#first%3A0', '.media-viewer')
    await loaded()
    await touchSwipe(-100, 0)
    await browser.until(async () => (await selected()).startsWith('file:'), 'horizontal touch swipe')
    await touchSwipe(0, -100)
    await browser.until(async () => await selected() === 'video:0', 'vertical touch swipe')
    await loaded()
    // Reduced motion omits the incoming animation but still navigates.
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, appSession)
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))')
    await browser.until(async () => (await selected()).startsWith('file:'), 'keyboard navigation')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-slide').getAnimations().length`), 0)
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, appSession)
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)

    // A file route works after reload without loading its referring message.
    const fileId = await evaluate('viewerTest.fileId')
    await evaluate(`location.href = '/chat/user/media#' + encodeURIComponent(${JSON.stringify(fileId)})`)
    await ready('.media-viewer')
    await loaded()
    assert.equal(await selected(), fileId)
    await evaluate('viewerTest.seed()')
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.equal(await evaluate('location.pathname'), '/chat/user')
    await push('/chat/user/media#' + encodeURIComponent(fileId), '.media-viewer')
    await loaded()
    await evaluate('viewerTest.remove()')
    await browser.until(async () => (await selected()) === 'video:0', 'deleted file advances to next media')
    await click('.viewer-close')
    await ready('.chat-screen')
    // Originals and template nodes stay bounded while traversing orphan files.
    for (const context of browser.contexts.values()) {
      if (context.origin !== origin || !context.auxData?.isDefault) continue
      const probe = await browser.send('Runtime.evaluate', { expression: 'Boolean(window.viewerTest)', contextId: context.id, returnByValue: true }, context.sessionId)
      if (probe.result.value) { appContext = context; break }
    }
    appSession = appContext.sessionId
    const many = await evaluate('viewerTest.seedMany()')
    await push('/chat/user/media#' + encodeURIComponent(many[0]), '.media-viewer')
    await loaded()
    await browser.send('HeapProfiler.collectGarbage', {}, appSession)
    const before = await appNodes()
    assert.ok(before.nodes > 100, JSON.stringify(before))
    await evaluate(`window.evictedImage = document.querySelector('${active}.viewer-asset[data-current=true] img')`)
    for (let n = 1; n < many.length; n++) {
      await browser.until(() => evaluate(`document.querySelector('${active}.viewer-next')?.disabled === false`), 'next page ready')
      await click('.viewer-next')
      await browser.until(async () => await selected() === many[n], 'selected paginated file')
      await loaded()
      assert.ok(await evaluate(`document.querySelectorAll('${active}.viewer-asset img[src], ${active}.viewer-asset video[src]').length <= 3`))
    }
    await browser.send('HeapProfiler.collectGarbage', {}, appSession)
    const after = await appNodes()
    console.log('Viewer app DOM before/after', before, after)
    assert.ok(after.nodes - before.nodes < 100, `DOM grew by ${after.nodes - before.nodes} nodes`)
    // Browser decode/timeout bookkeeping can briefly retain source-less Images.
    await evaluate('new Promise(resolve => setTimeout(resolve, 16000))')
    await browser.send('HeapProfiler.collectGarbage', {}, appSession)
    const settled = await appNodes()
    console.log('Viewer app DOM settled', settled)
    assert.ok(settled.images <= before.images + 6, `Retained ${settled.images - before.images} extra image nodes`)
    assert.ok(await evaluate(`document.querySelectorAll('${active}z-viewer-item').length === 3`))
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.equal(await evaluate('evictedImage.hasAttribute("src")'), false)
    assert.equal(await evaluate('document.querySelectorAll("z-media-viewer-route img[src], z-media-viewer-route video[src]").length'), 0)
    // A previously viewed external image survives a fresh offline read session.
    await browser.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, appSession)
    await push('/chat/user/media#' + encodeURIComponent(many[0]), '.media-viewer')
    await loaded()
    assert.ok(await evaluate(`document.querySelector('${active}.viewer-asset[data-current=true] img').src.startsWith('data:')`))
    await browser.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, appSession)
    // Rapid URL replacements must not paint an earlier asynchronous selection.
    await evaluate(`(() => { for (const id of ${JSON.stringify(many.slice(1, 8))}) testNavigation.replaceState({}, '', '/chat/user/media#' + encodeURIComponent(id)); })()`)
    await browser.until(() => evaluate(`document.querySelector('${active}.viewer-asset[data-current=true]')?.dataset.mediaId === ${JSON.stringify(many[7])}`), 'latest rapid selection')
    await loaded()
    await click('.viewer-close')
    await ready('.chat-screen')
    // A live count refresh preserves the current video's decoder and playback.
    const videoId = await evaluate("viewerTest.addFile(1, 'video/mp4')")
    await push('/chat/user/media#' + encodeURIComponent(videoId), '.media-viewer')
    await loaded()
    const counterBefore = await evaluate(`document.querySelector('${active}.viewer-header p').textContent`)
    await evaluate(`window.liveVideo = document.querySelector('${active}.viewer-asset[data-current=true] video'); window.livePauses = 0; liveVideo.addEventListener('pause', () => livePauses++); liveVideo.loop = true; liveVideo.muted = true; liveVideo.play()`)
    await evaluate("viewerTest.addFile(2, 'image/jpeg')")
    await browser.until(() => evaluate(`document.querySelector('${active}.viewer-header p').textContent !== ${JSON.stringify(counterBefore)}`), 'live file count')
    assert.equal(await evaluate('liveVideo.paused'), false)
    assert.equal(await evaluate('livePauses'), 0)
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.equal(await evaluate('liveVideo.paused && !liveVideo.hasAttribute("src")'), true)
    // Send real local attachments after previous viewer sessions, then open the
    // latest bubble and move backward through slots that were only neighbors.
    for (let n = 0; n < 4; n++) {
      // A reload can replace the frame/session while the old realm still
      // appears in CDP. Mark the document chosen by the runtime's evaluator.
      const marker = await evaluate('window.viewerPickerMarker = crypto.randomUUID()')
      const input = await browser.until(async () => {
        for (const context of browser.contexts.values()) {
          if (context.origin !== origin || !context.auxData?.isDefault) continue
          const result = await browser.send('Runtime.evaluate', { expression: `window.viewerPickerMarker === ${JSON.stringify(marker)} ? document.querySelector('.chat-composer input[type=file]') : null`, contextId: context.id }, context.sessionId)
          if (result.result.objectId) return { objectId: result.result.objectId, sessionId: context.sessionId }
        }
      }, 'file picker in the current app document')
      try {
        await browser.send('DOM.setFileInputFiles', { files: [path.join(root, `tests/browser/fixtures/media/jpeg-orientation-${n + 1}.jpg`)], objectId: input.objectId }, input.sessionId)
      } finally { await browser.send('Runtime.releaseObject', { objectId: input.objectId }, input.sessionId) }
      await browser.until(() => evaluate(`!!document.querySelector('${active}.composer-attachment .attachment-remove') && document.querySelector('${active}.compose-action')?.getAttribute('aria-disabled') === 'false' && !document.querySelector('${active}.preparing-file')`), 'new local attachment prepared', 30000)
      await click('.compose-action')
      // Alternate opening immediately and waiting for the real write to finish.
      if (n % 2) await browser.until(() => evaluate(`document.querySelectorAll('${active}.message-row .message-status[data-status=saved]').length === ${n + 1}`), 'new kind 9 saved', 60000)
      await browser.until(() => evaluate(`document.querySelectorAll('${active}.message-row .attachment-frame').length === ${n + 1}`), 'new bubble rendered')
      await evaluate(`document.querySelectorAll('${active}.message-row .attachment-frame').item(${n}).click()`)
      await ready('.media-viewer')
      await loaded()
      for (let previous = 0; previous < 6; previous++) {
        await browser.until(() => evaluate(`document.querySelector('${active}.viewer-previous')?.disabled === false`), 'previous slot available')
        const before = await selected()
        await click('.viewer-previous')
        await browser.until(async () => await selected() !== before, 'previous selection applied')
        await loaded()
      }
      await click('.viewer-close')
      await ready('.chat-screen')
    }
    // A controlled pending bubble uses real store persistence, delayed until
    // after opening. It must not be presented as a permanently missing file.
    const pendingId = await evaluate('viewerTest.stageFile()')
    await click('.message-row[data-message-id=controlled-pending] .attachment-frame')
    await ready('.media-viewer')
    await evaluate('new Promise(resolve => setTimeout(resolve, 500))')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-slide > .viewer-state p')?.textContent`), 'Loading media')
    await evaluate('viewerTest.finishFile()')
    await loaded()
    assert.equal(await selected(), pendingId)
    await click('.viewer-close')
    await ready('.chat-screen')

    // Hold actual image responses while delivering late native notifications.
    // An unloaded video/image in a reused slot must not mark its new image ready
    // or failed; a failed neighbor prefetch gets one fresh attempt on selection.
    await evaluate('viewerTest.seedUrls([\'https://viewer.example.com/held.jpg\', \'https://viewer.example.com/flaky.jpg\']); testNavigation.pushState({}, \'\', \'/chat/user/media#controlled-0%3A0\')')
    await ready('.media-viewer')
    await browser.until(() => heldMedia.length > 0, 'image preparation held at network boundary')
    await browser.until(() => evaluate(`!!document.querySelector('${active}.viewer-asset[data-media-id="controlled-1:0"] .viewer-state p')`), 'neighbor prefetch failed')
    await evaluate(`(() => {
      const asset = document.querySelector('${active}.viewer-asset[data-current=true]');
      asset.querySelector('img').dispatchEvent(new Event('load'));
      asset.querySelector('video').dispatchEvent(new Event('loadeddata'));
    })()`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await evaluate(`!!document.querySelector('${active}.viewer-asset[data-current=true] .loading')`), true, 'stale readiness does not hide the loading state')
    await evaluate(`document.querySelector('${active}.viewer-asset[data-current=true] video').dispatchEvent(new Event('error'))`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await evaluate(`!!document.querySelector('${active}.viewer-asset[data-current=true] .loading')`), true, 'inactive decoder errors do not fail the image')
    releaseHeldMedia = true
    heldMedia.splice(0).forEach(release => release())
    await loaded()
    rejectNeighbor = false
    await click('.viewer-next')
    await browser.until(async () => await selected() === 'controlled-1:0', 'failed neighbor selected')
    await loaded()
    await click('.viewer-previous')
    await loaded()
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.deepEqual(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown'), [])
  } catch (error) {
    if (inspectViewer) console.log('Viewer failure state', JSON.stringify(await inspectViewer().catch(() => null)))
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/media-viewer'))
    throw error
  } finally {
    heldMedia.splice(0).forEach(release => release())
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
