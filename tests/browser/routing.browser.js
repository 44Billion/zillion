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
    const options = buildOptions({ onEnd: result => { files = result } })
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
    await browser.until(() => evaluate('getComputedStyle(savedHome).getPropertyValue("--home-header-collapse").trim() === "1"'), 'home collapsed')
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
    assert.deepEqual(browser.logs.filter(log => log.method === 'Runtime.exceptionThrown' && log.sessionId === appSession), [])
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/routing'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
