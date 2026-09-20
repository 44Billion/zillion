import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('media viewer routes, same-chat navigation, gestures, native controls and retained state', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ onEnd: result => { files = result } })
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
          return {
            responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: url.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: url.pathname.endsWith('.mp4') ? mp4 : jpeg
          }
        }
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(url.hostname)) return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        return false
      }
    })
    permissions = setInterval(() => browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {}), 100)
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher ready')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const url = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app frame')
    const origin = new URL(url).origin
    const evaluate = expression => browser.evaluate(expression, origin)
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
    const loaded = () => browser.until(() => evaluate(`document.querySelector('${active}.viewer-asset')?.dataset.loaded === 'true'`), 'full media loaded')
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
    await evaluate('viewerTest.seed(); window.noReload = true')
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
    assert.ok((await selected()).startsWith('attachment:'))
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-footer p').textContent`), 'A photograph from this conversation')
    await swipe(0, -100)
    await loaded()
    assert.equal(await selected(), 'video:0')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-next').disabled`), true)
    await swipe(-100, 0)
    assert.equal(await selected(), 'video:0')
    await evaluate(`window.fullVideo = document.querySelector('${active}.viewer-asset video'); fullVideo.muted = true; fullVideo.play()`)
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

    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
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
      const point = await evaluate(`(() => { const r = document.querySelector('${active}.viewer-stage').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`)
      await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, session)
      for (let n = 1; n <= 4; n++) await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + dx * n / 4, y: point.y + dy * n / 4, id: 1 }] }, session)
      await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, session)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    }
    await push('/chat/user/media#first%3A0', '.media-viewer')
    await loaded()
    await touchSwipe(-100, 0)
    await browser.until(async () => (await selected()).startsWith('attachment:'), 'horizontal touch swipe')
    await touchSwipe(0, -100)
    await browser.until(async () => await selected() === 'video:0', 'vertical touch swipe')
    await loaded()
    // Reduced motion omits the incoming animation but still navigates.
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, appSession)
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))')
    await browser.until(async () => (await selected()).startsWith('attachment:'), 'keyboard navigation')
    assert.equal(await evaluate(`document.querySelector('${active}.viewer-slide').getAnimations().length`), 0)
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, appSession)
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)

    // Fresh route loading resolves the selection from current messages.
    await evaluate('location.href = "/chat/user/media#video%3A0"')
    await ready('.media-viewer')
    await evaluate('viewerTest.seed()')
    await loaded()
    assert.equal(await selected(), 'video:0')
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.equal(await evaluate('location.pathname'), '/chat/user')
    await push('/chat/user/media#first%3A0', '.media-viewer')
    await evaluate('viewerTest.remove()')
    await browser.until(() => evaluate(`!document.querySelector('${active}.viewer-asset')`), 'deleted media unavailable')
    await click('.viewer-close')
    await ready('.chat-screen')
    assert.deepEqual(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown'), [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/media-viewer'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
