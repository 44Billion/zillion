import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('full-height chat scroll keeps a growing composer sticky and excludes covered messages from read dwell', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    let files
    const options = buildOptions({ demo: true, sourceMaps: false, onEnd: result => { files = result } })
    options.plugins.push({
      name: 'chat-read-probe',
      setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/chat-read-probe.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'chat-scroll-test', name: 'Chat scroll test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 780, deviceScaleFactor: 1, mobile: false }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const evaluate = expression => browser.evaluate(expression, new URL(appUrl).origin)
    await browser.until(() => evaluate('Boolean(window.testNavigation && document.querySelector(".conversation [data-contact-id=maya]"))'), 'demo home')
    await evaluate('document.querySelector(".conversation [data-contact-id=maya]").click()')
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .chat-timeline")?.dataset.initialLoading === "false"'), 'chat settled')
    await evaluate(`(() => {
      window.chatTimeline = document.querySelector('.route-page[data-active=true] .chat-timeline');
      const content = chatTimeline.querySelector('.timeline-content');
      const target = document.createElement('div'); target.dataset.messageId = 'read-target'; target.style.height = '80px';
      const probe = document.createElement('template'); probe.innerHTML = '<z-chat-read-probe></z-chat-read-probe>';
      target.textContent = 'Controlled incoming read target'; content.append(target, probe.content);
    })()`)
    await browser.until(() => evaluate('Boolean(window.chatReadProbe?.timelineRef$())'), 'read probe mounted')
    const geometry = () => evaluate(`(() => {
      const box = e => { const r=e.getBoundingClientRect(); return {top:r.top,bottom:r.bottom,height:r.height,width:r.width} };
      return {screen:box(chatTimeline.closest('.chat-screen')),timeline:box(chatTimeline),footer:box(chatTimeline.querySelector('.chat-footer')),
        target:box(chatTimeline.querySelector('[data-message-id="read-target"]')),gap:chatTimeline.scrollHeight-chatTimeline.scrollTop-chatTimeline.clientHeight};
    })()`)
    const input = text => evaluate(`(() => { const input=chatTimeline.querySelector('textarea'); input.value=${JSON.stringify(text)}; input.dispatchEvent(new Event('input',{bubbles:true})); })()`)
    const wait = ms => evaluate(`new Promise(resolve => setTimeout(resolve, ${ms}))`)
    const position = hiddenPixels => evaluate(`(() => {
      chatTimeline.dispatchEvent(new WheelEvent('wheel',{deltaY:-1,bubbles:true}));
      chatTimeline.scrollTop=chatTimeline.scrollHeight-chatTimeline.clientHeight-${hiddenPixels};
    })()`)

    for (const width of [1024, 320]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor: 1, mobile: width === 320 }, session)
      await wait(200)
      await input('')
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      await evaluate('chatTimeline.dispatchEvent(new WheelEvent("wheel",{deltaY:1,bubbles:true})); chatTimeline.scrollTop=chatTimeline.scrollHeight')
      await browser.until(async () => Math.abs((await geometry()).gap) <= 2, 'bottom followed')
      await wait(150)
      const before = await geometry()
      assert.equal(before.timeline.height, before.screen.height)
      assert.ok(Math.abs(before.footer.bottom - before.timeline.bottom) <= 1)
      assert.ok(before.target.bottom <= before.footer.top)
      await input('line one\nline two\nline three\nline four\nline five')
      await browser.until(async () => (await geometry()).footer.height > before.footer.height + 50, 'composer grew')
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const grown = await geometry()
      // The launcher can resize its iframe while desktop/mobile chrome settles.
      // The scrollport must always span the current visible chat screen.
      assert.equal(grown.timeline.height, grown.screen.height)
      assert.ok(Math.abs(grown.footer.bottom - grown.timeline.bottom) <= 1)
      assert.ok(grown.target.bottom <= grown.footer.top + 1, `last message stays above expanded composer at bottom: ${JSON.stringify({ width, before, grown })}`)
      assert.ok(Math.abs(grown.gap) <= 2)
    }
    for (const height of [460, 780]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height, deviceScaleFactor: 1, mobile: true }, session)
      await browser.until(async () => Math.abs((await geometry()).gap) <= 2, 'visible viewport resized at bottom')
      const box = await geometry()
      assert.equal(box.timeline.height, box.screen.height)
      assert.ok(Math.abs(box.footer.bottom - box.timeline.bottom) <= 1)
      assert.ok(box.target.bottom <= box.footer.top + 1)
    }
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 780, deviceScaleFactor: 1, mobile: false }, session)
    await wait(150)
    const offset = await browser.evaluate(`(() => { const r=[...document.querySelectorAll('app-window iframe')].find(frame=>frame.src===${JSON.stringify(appUrl)}).getBoundingClientRect(); return {x:r.left,y:r.top}; })()`)
    const margin = { x: offset.x + 40, y: offset.y + (await geometry()).footer.bottom - 10 }
    const beforeWheel = await evaluate('chatTimeline.scrollTop')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...margin, deltaX: 0, deltaY: -50 }, session)
    await browser.until(() => evaluate(`chatTimeline.scrollTop < ${beforeWheel}`), 'native wheel at composer height outside center column')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...margin, deltaX: 0, deltaY: 500 }, session)
    await browser.until(async () => Math.abs((await geometry()).gap) <= 2, 'native return to bottom')
    await input('')
    await wait(150)
    await position(72)
    await wait(150)
    const covered = await geometry()
    assert.ok(covered.target.top < covered.footer.top && covered.target.bottom > covered.footer.top)
    assert.ok(covered.footer.top - covered.target.top < covered.target.height / 2)
    await evaluate('chatReadProbe.enabled$(true)')
    await wait(2300)
    assert.deepEqual(await evaluate('chatReadCalls'), [], 'less than half visible does not count as read')

    await position(28)
    await wait(150)
    const visible = await geometry()
    assert.ok(visible.footer.top - visible.target.top >= visible.target.height / 2)
    await wait(500)
    await input('one\ntwo\nthree\nfour\nfive')
    await wait(2300)
    assert.deepEqual(await evaluate('chatReadCalls'), [], 'composer growth interrupts a pending read dwell')
    await input('')
    await browser.until(() => evaluate('chatReadCalls.some(call => call.id === "read-target")'), 'continuous visible dwell marks target read', 6000)

    await input('Retained sticky draft')
    await wait(150)
    await evaluate('chatReadProbe.enabled$(false); window.retainedTop=chatTimeline.scrollTop; testNavigation.pushState({}, "", "/contacts")')
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .contacts-screen")'), 'contacts route')
    await evaluate('testNavigation.back()')
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .chat-timeline") === chatTimeline && !document.querySelector("[data-transitioning]")'), 'retained chat returned')
    assert.ok(Math.abs(await evaluate('chatTimeline.scrollTop-retainedTop')) <= 2)
    assert.equal(await evaluate('chatTimeline.querySelector("textarea").value'), 'Retained sticky draft')
    assert.equal(await evaluate('chatTimeline.closest(".route-scroll").scrollTop'), 0, 'no second scrolling container')
    assert.equal(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown').length, 0)
  } catch (error) {
    if (browser) {
      const dir = path.join(root, 'tmp/browser-failures/chat-scroll')
      await mkdir(dir, { recursive: true })
      await writeFile(path.join(dir, 'error.txt'), error.stack || String(error))
      await browser.diagnose(dir)
    }
    throw error
  } finally { await browser?.close(); await runtime.close() }
})
