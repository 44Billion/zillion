import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('status icons use natural width and only expansion animates, including bubble wrapping', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const files = await compile()
    const options = buildOptions({ development: true, onEnd: extra => files.push(...extra.filter(file => file.name !== '.well-known/napp.json')) })
    options.entryPoints = [{ in: 'tests/browser/status-fixture.js', out: '__tests__/status-fixture' }]
    options.entryNames = '[dir]/[name]'
    await esbuild.build(options)
    files.splice(files.findIndex(file => file.name === 'index.html'), 1, { name: 'index.html', bytes: new TextEncoder().encode('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><script type="module" src="/__tests__/status-fixture.js"></script></head><body><z-status-fixture></z-status-fixture></body></html>') })
    const app = await prepareTestApp(files, { identifier: 'status-width-test', name: 'Status width test' })
    browser = await launchChrome({ intercept: request => /^(?:[a-z0-9-]+\.)*localhost$/.test(new URL(request.url).hostname) ? null : false })
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(appUrl).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    await browser.until(() => evaluate('!!document.querySelector(".status-indicator svg") && !__statusTest.layout.initial$()'), 'mounted status fixture')
    await evaluate(`(() => {
      const original = Element.prototype.animate;
      window.statusAnimations = [];
      Element.prototype.animate = function (...args) {
        const animation = original.apply(this, args);
        statusAnimations.push({target:this.className, status:document.querySelector('.message-status')?.dataset.status, keyframes:args[0], options:args[1]});
        return animation;
      };
      window.geometry = () => {
        const slot = document.querySelector('.message-status').getBoundingClientRect();
        const bubble = document.querySelector('.chat-bubble').getBoundingClientRect();
        const viewport = document.querySelector('.status-timeline').getBoundingClientRect();
        return {width:slot.width, height:slot.height, bubbleWidth:bubble.width, bubbleHeight:bubble.height, bottomGap:viewport.bottom - bubble.bottom};
      };
      window.transition = async (status, extra = {}) => {
        statusAnimations.length = 0;
        const frames = [geometry()];
        __statusTest.view.message$(value => ({...value, ...extra, status}));
        const until = performance.now() + 450;
        while (performance.now() < until) {
          // Sample after ResizeObserver has made its pre-paint corrections;
          // an rAF callback itself runs before those observers.
          await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
          frames.push(geometry());
        }
        return {frames, animations:statusAnimations};
      };
    })()`)
    const pending = await evaluate('geometry()')
    assert.equal(pending.width, 14)
    assert.equal(pending.height, 14)
    const error = await evaluate('transition("error")')
    assert.equal(error.animations.length, 0)
    assert.deepEqual(error.frames.at(-1), pending)
    const saved = await evaluate('transition("saved")')
    assert.ok(saved.frames.at(-1).width > 14)
    assert.equal(saved.frames.at(-1).height, pending.height)
    assert.ok(saved.frames.some(frame => frame.width > 14.5 && frame.width < saved.frames.at(-1).width - 0.5), 'intermediate width is painted')
    assert.ok(saved.frames.some(frame => frame.bubbleWidth > pending.bubbleWidth + 0.5 && frame.bubbleWidth < saved.frames.at(-1).bubbleWidth - 0.5), 'short bubble grows with its metadata')
    assert.deepEqual(saved.animations.filter(item => item.target === 'message-status').map(item => item.options), [{ duration: 150, easing: 'ease-out' }])
    assert.equal((await evaluate('transition("pending")')).animations.length, 0, 'contraction has no animation')

    // Find a real line-wrap boundary using the shipped text and float styles.
    await evaluate('__statusTest.layout.initial$(true)')
    const boundary = await evaluate(`(async () => {
      for (let length = 12; length < 60; length++) {
        __statusTest.view.message$(value => ({...value, text:'x'.repeat(length), status:'pending'}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const before = geometry();
        __statusTest.view.message$(value => ({...value, status:'saved'}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (geometry().bubbleHeight > before.bubbleHeight + 10) return {length, before, after:geometry()};
      }
    })()`)
    assert.ok(boundary, 'fixture reaches a wrapping threshold')
    await evaluate('transition("pending")')
    await evaluate('__statusTest.layout.initial$(false)')
    const wrapped = await evaluate('transition("saved")')
    assert.ok(wrapped.animations.some(item => item.target === 'message-growth'), JSON.stringify(wrapped))
    assert.ok(wrapped.frames.some(frame => frame.bubbleHeight > boundary.before.bubbleHeight + 0.5 && frame.bubbleHeight < boundary.after.bubbleHeight - 0.5), 'height is interpolated across the wrap')
    assert.deepEqual(wrapped.frames.at(-1), boundary.after)
    assert.ok(wrapped.frames.slice(1).every((frame, i) => Math.abs(frame.bubbleHeight - wrapped.frames[i].bubbleHeight) < 10), 'no full-line height jump, including animation completion: ' + JSON.stringify(wrapped))
    assert.equal((await evaluate('transition("pending")')).animations.length, 0, 'wrapping contraction is immediate')
    assert.equal(await evaluate('document.querySelector(".message-status").style.width + document.querySelector(".message-status").style.overflow + document.querySelector(".message-growth").style.height + document.querySelector(".message-growth").style.overflow'), '', 'temporary styles are released')
    await evaluate(`(async () => {
      document.querySelector('.status-list').style.paddingTop = '600px';
      await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    })()`)
    const pinned = await evaluate('transition("saved")')
    const gaps = pinned.frames.map(frame => frame.bottomGap)
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, 'bottom stays anchored throughout width and wrapping-height animation: ' + JSON.stringify(gaps))
    await evaluate('transition("pending")')

    const appSession = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault).sessionId
    await browser.send('Page.setFontSizes', { fontSizes: { standard: 20 } }, appSession)
    await browser.until(() => evaluate('geometry().height > 14'), 'larger preferred font adjusts metadata height')
    const largeFontHeight = await evaluate('geometry().height')
    assert.equal((await evaluate('transition("saved")')).frames.at(-1).height, largeFontHeight, 'icon and time keep equal height with larger fonts')
    await browser.send('Page.setFontSizes', { fontSizes: { standard: 16 } }, appSession)
    await evaluate('transition("pending")')
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, appSession)
    assert.equal((await evaluate('transition("saved")')).animations.length, 0, 'reduced motion suppresses expansion')
    await browser.send('Emulation.setEmulatedMedia', { features: [] }, appSession)
    await evaluate('transition("pending")')
    await evaluate('__statusTest.page.isActive$(false)')
    assert.equal((await evaluate('transition("saved")')).animations.length, 0, 'inactive routes do not animate')
    await evaluate('__statusTest.page.isActive$(true)')
    assert.equal(await evaluate('document.getAnimations().length'), 0, 'returning does not replay expansion')
    await evaluate('__statusTest.layout.initial$(true)')
    await evaluate('transition("pending")')
    assert.equal((await evaluate('transition("saved")')).animations.length, 0, 'initial history skips width and height animation')
    await evaluate('__statusTest.layout.initial$(false); transition("pending")')
    const interrupted = await evaluate(`(async () => {
      __statusTest.view.message$(value => ({...value, status:'saved'}));
      await new Promise(resolve => setTimeout(resolve, 60));
      const partial = geometry();
      const result = await transition('error');
      return {partial, result};
    })()`)
    assert.ok(interrupted.partial.width > 14 && interrupted.partial.width < saved.frames.at(-1).width, 'interrupt during expansion')
    assert.equal(interrupted.result.animations.filter(animation => animation.status === 'error').length, 0)
    assert.ok(interrupted.result.frames.slice(1).every(frame => frame.width === 14), 'every painted contraction frame uses the icon width')
    assert.equal(interrupted.result.frames.at(-1).width, 14, 'cancelled completion cannot restore stale width')
    assert.equal(await evaluate('document.getAnimations().length'), 0)
    await evaluate(`(async () => {
      __statusTest.view.message$(value => ({...value, status:'saved'}));
      await new Promise(resolve => setTimeout(resolve, 30));
      window.visualViewport.dispatchEvent(new Event('resize'));
    })()`)
    assert.equal(await evaluate('document.getAnimations().length'), 0, 'keyboard resize settles both animations')
    await evaluate('transition("pending")')
    await evaluate(`(async () => {
      __statusTest.view.message$(value => ({...value, status:'saved'}));
      await new Promise(resolve => setTimeout(resolve, 30));
      __statusTest.page.isActive$(false);
    })()`)
    assert.equal(await evaluate('document.getAnimations().length'), 0, 'leaving mid-animation cancels it')
    await evaluate('__statusTest.page.isActive$(true); transition("pending")')
    await evaluate(`(async () => {
      window.detachedStatus = document.querySelector('.message-status');
      window.detachedGrowth = document.querySelector('.message-growth');
      __statusTest.view.message$(value => ({...value, status:'saved'}));
      await new Promise(resolve => setTimeout(resolve, 30));
      __statusTest.view.mounted$(false);
      await new Promise(resolve => setTimeout(resolve, 30));
    })()`)
    assert.equal(await evaluate('detachedStatus.getAnimations().length'), 0, 'unmount cancels width animation')
    assert.equal(await evaluate('detachedStatus.style.overflow'), '')
    assert.equal(await evaluate('detachedGrowth.style.height + detachedGrowth.style.overflow'), '')
    assert.deepEqual(await evaluate('statusErrors'), [], 'no observer loops or late updates after teardown')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/status-width'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
