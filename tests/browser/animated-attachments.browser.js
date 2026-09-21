import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('animated attachments play in bubbles and release sources across viewer navigation and reload', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ onEnd: result => { files = result } })
    options.sourcemap = false
    options.plugins.push({
      name: 'animated-attachments-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/route-driver.js"\nimport "../../tests/browser/fixtures/animated-attachments-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'animated-attachments-test', name: 'Animated attachments test' })
    browser = await launchChrome({
      intercept: request => /^(?:[a-z0-9-]+\.)*localhost$/.test(new URL(request.url).hostname) ? null : false
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
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')
    await browser.until(() => evaluate('Boolean(window.animationTest?.account.send && window.testNavigation)'), 'animation driver')
    await evaluate('testNavigation.pushState({}, "", "/chat/user")')
    await evaluate('animationTest.account.recover()')
    await browser.until(() => evaluate('animationTest.account.historyState$() === "loaded"'), 'chat ready')
    const ids = []
    const imageSelector = id => `.route-page[data-active=true] [data-message-id="${id}"] .attachment-frame img:not(.attachment-placeholder)`
    const show = async id => {
      await browser.until(() => evaluate(`!!document.querySelector('.route-page[data-active=true] [data-message-id="${id}"] .chat-attachment')`), 'attachment metadata rendered')
      await evaluate(`document.querySelector('.route-page[data-active=true] .chat-timeline').dispatchEvent(new WheelEvent('wheel', {deltaY:-100,bubbles:true})); document.querySelector('[data-message-id="${id}"]').scrollIntoView({block:'center'})`)
      await browser.until(() => evaluate(`(() => { const image = document.querySelector(${JSON.stringify(imageSelector(id))}); if (!image?.complete || !image.naturalWidth) return false; const r = image.getBoundingClientRect(); if (r.top < 55 || r.bottom > innerHeight - 65) { image.scrollIntoView({block:'center'}); return false; } return image.checkVisibility({checkVisibilityCSS:true}); })()`), 'visible bubble image')
    }
    const moving = async selector => {
      const rect = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:r.x+r.width/2-8,y:r.y+r.height/2-8}; })()`)
      const offset = await browser.evaluate(`(() => { const r = [...document.querySelectorAll('app-window iframe')].find(f => new URL(f.src).origin === ${JSON.stringify(origin)}).getBoundingClientRect(); return {x:r.x,y:r.y}; })()`)
      const clip = { x: rect.x + offset.x, y: rect.y + offset.y, width: 16, height: 16, scale: 1 }
      const capture = async () => (await browser.send('Page.captureScreenshot', { format: 'png', clip }, session)).data
      const first = await capture()
      await browser.until(async () => (await capture()) !== first, 'animation changes visible pixels', 5000)
    }
    for (const [extension, mime] of [['gif', 'image/gif'], ['webp', 'image/webp'], ['png', 'image/png']]) {
      const name = 'animated-playback.' + extension
      const bytes = [...await readFile(path.join(root, 'tests/browser/fixtures/media', name))]
      const id = await evaluate(`animationTest.send(${JSON.stringify(bytes)}, ${JSON.stringify(name)}, ${JSON.stringify(mime)})`)
      ids.push(id)
      await browser.until(() => evaluate(`animationTest.account.messages$().find(m => m.id === '${id}')?.status === 'saved'`), 'animated attachment saved')
      await show(id)
      assert.ok(await evaluate(`document.querySelector(${JSON.stringify(imageSelector(id))}).src.startsWith('https://nostr.alt/')`), 'bubble plays original bytes')
      await moving(imageSelector(id))
      await evaluate(`window.animationImage = document.querySelector(${JSON.stringify(imageSelector(id))}); animationImage.closest('.attachment-frame').click()`)
      await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .viewer-asset[data-loaded=true]")'), 'viewer image ready')
      assert.equal(await evaluate('animationImage.hasAttribute("src")'), false, 'retained bubble releases original source')
      await moving('.route-page[data-active=true] .viewer-asset[data-current=true] img')
      await evaluate('document.querySelector(".route-page[data-active=true] .viewer-close").click()')
      await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .chat-screen") && !document.querySelector("[data-transitioning]")'), 'chat restored')
      await show(id)
      await moving(imageSelector(id))
      console.log('Animated bubble, viewer and return verified:', extension)
    }
    // A fresh realm drops preview flags: regenerate them from stored nfiles offline.
    await evaluate('window.beforeAnimationReload = true; location.reload()')
    await browser.until(() => evaluate('!window.beforeAnimationReload && window.animationTest?.account.historyState$() === "loaded"'), 'offline reload')
    for (const id of ids) { await show(id); await moving(imageSelector(id)); console.log('Offline animation restored:', id) }
    // Static images retain the reduced preview path.
    const bytes = [...await readFile(path.join(root, 'tests/browser/fixtures/media/webp-False.webp'))]
    const id = await evaluate(`animationTest.send(${JSON.stringify(bytes)}, 'still.webp', 'image/webp')`)
    await browser.until(() => evaluate(`animationTest.account.messages$().find(m => m.id === '${id}')?.status === 'saved'`), 'static attachment saved')
    await show(id)
    assert.ok(await evaluate(`document.querySelector(${JSON.stringify(imageSelector(id))}).src.startsWith('blob:')`), 'static WebP still uses thumbnail')
    assert.equal(browser.logs.filter(entry => entry.method === 'Runtime.exceptionThrown').length, 0, JSON.stringify(browser.logs))
  } catch (error) {
    console.error(error)
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/animated-attachments'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
