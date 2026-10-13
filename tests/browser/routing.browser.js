import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('route retention, eviction and mobile page transitions in the real launcher', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    let files
    const options = buildOptions({ demo: true, onEnd: result => { files = result } })
    options.plugins.push({
      name: 'routing-test-driver',
      setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/route-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'routing-test', name: 'Routing test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(appUrl).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    const settled = () => browser.until(() => evaluate(`(() => {
      const route = testNavigation.route$();
      const page = document.querySelector('.route-page[data-active=true]');
      return page?.dataset.routeId === route.uid + ':' + route.url.pathname + route.url.search && Boolean(page.querySelector('main')) && !document.querySelector('[data-transitioning]');
    })()`), 'page transition settled')
    const go = async delta => {
      const uid = await evaluate('testNavigation.route$().uid')
      await evaluate(`testNavigation.go(${delta})`)
      await browser.until(() => evaluate(`testNavigation.route$().uid === ${uid + delta}`), 'history navigation')
      await settled()
    }
    const push = async url => {
      await evaluate(`testNavigation.pushState({}, '', ${JSON.stringify(url)})`)
      await settled()
    }
    await browser.until(() => evaluate('Boolean(window.testNavigation && document.querySelector(".contact-list"))'), 'home ready')
    await evaluate(`(() => {
      window.routeAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        if (this.matches('.route-page')) routeAnimations.push({ frames, options });
        return animate.call(this, frames, options);
      };
      window.savedHome = document.querySelector('.home');
      savedHome.closest('.route-scroll').scrollTop = 210;
      savedHome.querySelector('.contact-list').scrollLeft = 10000;
    })()`)
    await browser.until(async () => {
      await browser.evaluate('document.querySelector("dialog[open] .permission-button.allow-button:not(:disabled)")?.click()')
      return evaluate('savedHome.closest(".route-scroll").scrollTop = 210; getComputedStyle(savedHome).getPropertyValue("--home-header-collapse").trim() === "1"')
    }, 'home collapsed')
    const homeState = await evaluate('({ top: savedHome.closest(".route-scroll").scrollTop, left: savedHome.querySelector(".contact-list").scrollLeft })')
    await evaluate('document.querySelector(".conversation [data-contact-id=maya]").click()')
    await settled()
    assert.equal(await evaluate('savedHome.isConnected && savedHome.closest(".route-page").inert'), true)
    assert.equal(await evaluate('getComputedStyle(savedHome.closest(".route-page")).visibility'), 'hidden')
    assert.deepEqual(await evaluate('routeAnimations.at(-1)'), {
      frames: [{ transform: 'translateX(30%)', opacity: 0.55 }, { transform: 'translateX(0)', opacity: 1 }],
      options: { duration: 150, easing: 'ease', fill: 'both' }
    })
    await evaluate(`(() => {
      window.savedChat = document.querySelector('.chat-screen');
      const input = savedChat.querySelector('textarea');
      input.value = 'Unsent draft\\nSecond line';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      savedChat.querySelector('.chat-timeline').scrollTop = 140;
    })()`)
    await browser.until(() => evaluate('savedChat.querySelector(".chat-timeline").scrollTop === 140'), 'chat scroll away from bottom')
    await push('/chat/daniel')
    await go(-1)
    assert.equal(await evaluate('savedChat === document.querySelector(".route-page[data-active=true] .chat-screen")'), true)
    assert.equal(await evaluate('savedChat.querySelector("textarea").value'), 'Unsent draft\nSecond line')
    assert.equal(await evaluate('savedChat.querySelector(".chat-timeline").scrollTop'), 140)
    assert.deepEqual(await evaluate('routeAnimations.at(-1).frames'), [{ transform: 'translateX(0)' }, { transform: 'translateX(-100%)' }])
    await go(-1)
    assert.deepEqual(await evaluate('({ top: savedHome.closest(".route-scroll").scrollTop, left: savedHome.querySelector(".contact-list").scrollLeft })'), homeState)
    assert.equal(await evaluate('getComputedStyle(savedHome).getPropertyValue("--home-header-collapse").trim()'), '1')
    const retainedAvatars = await evaluate('[...document.querySelectorAll(".route-page[data-active=false] .chat-avatar img")].map(img => ({ loaded: img.complete && img.naturalWidth > 0, visibility: getComputedStyle(img).visibility }))')
    assert.ok(retainedAvatars.length > 0)
    assert.ok(retainedAvatars.every(avatar => avatar.loaded && avatar.visibility === 'hidden'), 'retained chat avatars must not show through the home page')
    await go(1)
    await browser.until(() => evaluate('getComputedStyle(document.querySelector(".route-page[data-active=true] .chat-avatar img")).visibility === "visible"'), 'chat avatar reappears on Forward')

    // Keep the actual retained scrollers while exercising native input in the
    // desktop margins. No synthetic scroll events or gesture forwarding.
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 700, deviceScaleFactor: 1, mobile: false }, session)
    const desktopGeometry = (scroll, content) => evaluate(`(() => {
      const s = document.querySelector(${JSON.stringify(scroll)}), c = document.querySelector(${JSON.stringify(content)});
      const r = s.getBoundingClientRect(), column = c.getBoundingClientRect();
      return { width: r.width, right: r.right, viewport: innerWidth, column: column.width, center: column.left + column.width / 2,
        gutter: getComputedStyle(s).scrollbarGutter, scrollbar: getComputedStyle(s).scrollbarWidth, overflow: s.scrollWidth > s.clientWidth };
    })()`)
    const checkDesktop = async (scroll, content, columnWidth) => {
      const box = await desktopGeometry(scroll, content)
      assert.equal(box.width, box.viewport)
      assert.equal(box.right, box.viewport, 'scrollbar belongs to the right edge of the app')
      assert.equal(box.column, columnWidth)
      assert.ok(Math.abs(box.center - box.viewport / 2) < 1, 'content remains centered including classic scrollbar gutters')
      assert.equal(box.gutter, 'stable both-edges')
      assert.equal(box.scrollbar, 'auto')
      assert.equal(box.overflow, false, 'no horizontal overflow')
    }
    const frameOffset = await browser.evaluate(`(() => {const frame=[...document.querySelectorAll('app-window iframe')].find(frame=>frame.src.startsWith('${origin}'));const r=frame.getBoundingClientRect();return {x:r.left,y:r.top}})()`)
    const margin = { x: frameOffset.x + 40, y: frameOffset.y + 350 }
    await go(-1)
    await checkDesktop('.route-page[data-active=true] .route-scroll', '.route-page[data-active=true] .home', 718)
    await evaluate('window.desktopHomeScroll = savedHome.closest(".route-scroll")')
    const beforeWheel = await evaluate('desktopHomeScroll.scrollTop')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...margin, deltaX: 0, deltaY: -100 }, session)
    await browser.until(() => evaluate(`desktopHomeScroll.scrollTop < ${beforeWheel}`), 'native home wheel scroll from left margin')
    await evaluate('new Promise(resolve => setTimeout(resolve, 200))')
    const beforeTouch = await evaluate('desktopHomeScroll.scrollTop')
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, session)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...margin, id: 1 }] }, session)
    for (let n = 1; n <= 4; n++) {
      await new Promise(resolve => setTimeout(resolve, 25))
      await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: margin.x, y: margin.y - n * 25, id: 1 }] }, session)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, session)
    await browser.until(() => evaluate(`desktopHomeScroll.scrollTop > ${beforeTouch}`), 'native home touch scroll from left margin')
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)
    await evaluate('new Promise(resolve => setTimeout(resolve, 500))')
    const desktopHomeTop = await evaluate('desktopHomeScroll.scrollTop')
    await go(1)
    await checkDesktop('.route-page[data-active=true] .chat-timeline', '.route-page[data-active=true] .timeline-content', 692)
    assert.equal(await evaluate('document.querySelector(".route-page[data-active=true] .chat-composer").getBoundingClientRect().width'), 718)
    await evaluate('window.desktopChatScroll = savedChat.querySelector(".chat-timeline")')
    const chatBeforeWheel = await evaluate('desktopChatScroll.scrollTop')
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...margin, deltaX: 0, deltaY: -100 }, session)
    await browser.until(() => evaluate(`desktopChatScroll.scrollTop < ${chatBeforeWheel}`), 'native chat wheel scroll from left margin')
    await evaluate('new Promise(resolve => setTimeout(resolve, 200))')
    const chatBeforeTouch = await evaluate('desktopChatScroll.scrollTop')
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, session)
    await browser.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...margin, id: 1 }] }, session)
    for (let n = 1; n <= 4; n++) {
      await new Promise(resolve => setTimeout(resolve, 25))
      await browser.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: margin.x, y: margin.y - n * 25, id: 1 }] }, session)
    }
    await new Promise(resolve => setTimeout(resolve, 25))
    await browser.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, session)
    await browser.until(() => evaluate(`desktopChatScroll.scrollTop > ${chatBeforeTouch}`), 'native chat touch scroll from left margin')
    await browser.send('Emulation.setTouchEmulationEnabled', { enabled: false }, session)
    await evaluate('new Promise(resolve => setTimeout(resolve, 500))')
    const desktopChatTop = await evaluate('desktopChatScroll.scrollTop')
    await go(-1)
    assert.equal(await evaluate('desktopHomeScroll === document.querySelector(".route-page[data-active=true] .route-scroll")'), true)
    assert.equal(await evaluate('desktopHomeScroll.scrollTop'), desktopHomeTop, 'Back restores the home margin scroll position')
    await go(1)
    assert.equal(await evaluate('desktopChatScroll === document.querySelector(".route-page[data-active=true] .chat-timeline")'), true)
    assert.equal(await evaluate('desktopChatScroll.scrollTop'), desktopChatTop, 'Forward restores the chat margin scroll position')
    assert.equal(await evaluate('savedChat.querySelector("textarea").value'), 'Unsent draft\nSecond line')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true }, session)

    await push('/chat/user')
    assert.equal(await evaluate('document.querySelector(".chat-screen[data-contact-id=daniel]")'), null)
    await push('/chat/daniel')
    await evaluate('window.savedLaterChat = document.querySelector(".route-page[data-active=true] .chat-screen")')
    await push('/missing/4')
    assert.equal(await evaluate('savedHome.isConnected'), true)
    await push('/missing/5')
    assert.equal(await evaluate('savedHome.isConnected'), false)
    await push('/missing/6')
    assert.equal(await evaluate('savedChat.isConnected'), false)
    await push('/missing/7')
    assert.equal(await evaluate('savedLaterChat.isConnected'), true)
    assert.equal(await evaluate('document.querySelectorAll(".route-page").length'), 5)
    await push('/missing/8')
    assert.equal(await evaluate('savedLaterChat.isConnected'), false)
    await go(-5)
    assert.equal(await evaluate('document.querySelector(".route-page[data-active=true] .chat-screen").dataset.contactId'), 'daniel')
    assert.equal(await evaluate('document.querySelector(".route-page[data-active=true] textarea").value'), '')
    assert.equal(await evaluate('[...document.querySelectorAll(".route-page")].filter(page => !page.inert).length'), 1)

    const count = await evaluate('routeAnimations.length')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 1024, height: 700, deviceScaleFactor: 1, mobile: false }, session)
    await go(1)
    assert.equal(await evaluate('routeAnimations.length'), count)
    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, appSession)
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 700, deviceScaleFactor: 1, mobile: true }, session)
    await go(-1)
    assert.equal(await evaluate('routeAnimations.length'), count)
    await evaluate('testNavigation.replaceState({}, "", "/chat/daniel?entry=1")')
    await browser.until(() => evaluate('Boolean(document.querySelector(".route-page[data-active=true] .entry-logo"))'), 'replace with embedded entry')
    await settled()
    assert.equal(await evaluate('routeAnimations.length'), count)
    await evaluate('document.querySelector(".route-page[data-active=true] .chat-back").click()')
    assert.equal(await evaluate('location.pathname + location.search'), '/chat/daniel?entry=1')
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .attachment-frame img")?.naturalWidth > 0'), 'promised demonstration photo')
    assert.deepEqual(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown' && log.sessionId === appSession), [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/routing'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
