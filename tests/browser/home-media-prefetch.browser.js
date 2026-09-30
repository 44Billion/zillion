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

test('visible home chats prepare five local previews and reserve geometry before opening', { timeout: 180000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let artifacts
    const options = buildOptions({ onEnd: result => { artifacts = result } })
    options.sourcemap = false
    options.plugins.push({
      name: 'home-summaries-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/home-summaries-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
        build.onLoad({ filter: /src\/components\/hooks\/use-account\.js$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace("from '#services/contacts.js'", "from '../../../tests/browser/fixtures/contact-readiness.js'")
            .replace("from '#services/private-chats.js'", "from '../../../tests/browser/fixtures/contact-readiness.js'")
            .replaceAll('window.napp.eventStore', 'window.contactBoot.observeStore(window.napp.eventStore)'),
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(artifacts, { identifier: 'home-summaries-test', name: 'Home summaries test' })
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
    await browser.until(() => evaluate('contactBoot.account.contactsState$() === "loaded"'), 'initial local contacts')
    const peer = getPublicKey(generateSecretKey())
    await evaluate(`contactBoot.account.setContact('${peer}', true)`)
    const base = Math.floor(Date.now() / 1000) - 1000
    const files = []
    const video = [...await readFile(path.join(root, 'tests/browser/fixtures/media/vp9.webm'))]
    for (let index = 0; index < 6; index++) {
      const options = { peer, at: base + index, index, name: `local-${index}.${index === 5 ? 'webm' : 'png'}`, ...(index === 5 ? { mime: 'video/webm', bytes: video } : {}) }
      files.push(await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify(options)})`))
    }
    const missing = await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify({ peer, at: base + 10, index: 10, name: 'missing.png', stored: 'none' })})`)
    const partial = await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify({ peer, at: base + 9, name: 'partial.png', bytes: new Array(51001).fill(17), stored: 'partial' })})`)
    const pdf = await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify({ peer, at: base + 8, name: 'excluded.pdf', bytes: [1, 2, 3], mime: 'application/pdf' })})`)
    const audio = await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify({ peer, at: base + 7, name: 'excluded.ogg', bytes: [4, 5, 6], mime: 'audio/ogg' })})`)
    const hash = await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify({ peer: pubkey, at: base + 21, index: 12, name: 'hash.png', hash: true, stored: 'none' })})`)
    const thumb = await evaluate(`contactBoot.seedPreviewMedia(${JSON.stringify({ peer: pubkey, at: base + 20, index: 14, name: 'thumb.webm', bytes: [9, 8, 7], mime: 'video/webm', stored: 'none', thumb: true, dimensions: true })})`)
    await browser.evaluate(`(() => {
      const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)});
      const url = new URL(frame.src); url.pathname = '/'; url.search = '?holdOutbox=1'; frame.src = url.href;
    })()`)
    await browser.until(() => evaluate(`contactBoot.account.historyLoaded$() && contactBoot.account.conversations$()['${peer}']?.historyLoaded`), 'both visible first pages load')
    await browser.until(() => evaluate(`(async () => (await Promise.all(${JSON.stringify([...files.slice(1), thumb])}.map(file => contactBoot.previewInfo(file)))).every(Boolean))()`), 'five recent files and a local thumb prepare before visiting', 45000)
    assert.equal(await evaluate(`contactBoot.previewInfo(${JSON.stringify(files[0])})`), null, 'the sixth older file is not prepared')
    assert.deepEqual(await evaluate(`contactBoot.previewInfo(${JSON.stringify(files[4])})`), { width: 240, height: 100 }, 'missing metadata dimensions are discovered locally')
    assert.deepEqual(await evaluate(`contactBoot.previewInfo(${JSON.stringify(thumb)})`), { width: 340, height: 100 }, 'a local thumb reserves the original geometry without the original')
    assert.equal(await evaluate(`contactBoot.previewInfo(${JSON.stringify(missing)})`), null)
    assert.equal(await evaluate(`contactBoot.previewInfo(${JSON.stringify(partial)})`), null)
    const reads = await evaluate('contactBoot.reads')
    for (const file of [hash, thumb, pdf, audio, files[0]]) {
      assert.ok(!reads.some(read => read.filter.kinds?.includes(34601) && read.filter['#d']?.some(id => file.chunkIds.includes(id))), 'hash/thumb originals, PDFs, audio and the sixth file have no chunk reads')
    }
    assert.deepEqual(await evaluate('contactBoot.mediaStates'), [], 'prefetch never enters transfer UI or remote download coordination')
    const requests = await evaluate('contactBoot.localRequests')
    assert.ok(requests.length > 0)
    assert.ok(requests.every(request => new URL(request.url).searchParams.get('localOnly') === '1'), 'every preview byte request forbids remote fallback')
    assert.ok(!requests.some(request => request.url.includes(thumb.url.split('/').at(-1)) || request.url.includes(hash.url.split('/').at(-1))), 'available previews do not open originals')
    await evaluate('contactBoot.watchGeometry(\'local-4.png\')')
    await evaluate(`document.querySelector('.conversation button[data-contact-id="${peer}"]').click()`)
    await browser.until(() => evaluate('contactBoot.geometry.length > 0'), 'cached dimensions are present from the first mounted frame')
    await browser.until(() => evaluate('(() => { const attachment = [...document.querySelectorAll(\'.route-page[data-active=true] .chat-attachment\')].find(node => node.textContent.includes(\'local-4.png\')); return attachment?.querySelector(\'img\')?.naturalWidth > 0 })()'), 'the prepared preview renders')
    await evaluate('contactBoot.stopGeometry()')
    const geometry = await evaluate('contactBoot.geometry')
    assert.ok(geometry[0].height > 0)
    assert.ok(geometry.every(size => Math.abs(size.width / size.height - 2.4) < 0.02), 'all frames keep the original aspect ratio')
    assert.ok(geometry.every(size => Math.abs(size.height - geometry[0].height) < 1), 'preparation causes no bubble height shift')
    console.log('Five previews, thumb/hash-only paths, missing/partial files, local-only requests and stable initial geometry verified')
    await evaluate('contactBoot.releaseQueue()')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/home-media-prefetch'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
