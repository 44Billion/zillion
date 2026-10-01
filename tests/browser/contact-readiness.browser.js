import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('direct peer routes wait for local contact membership without waiting for transport recovery', { timeout: 120000 }, async () => {
  const downloads = await mkdtemp(path.join(os.tmpdir(), 'zillion-cached-downloads-'))
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ onEnd: result => { files = result } })
    options.sourcemap = false
    options.plugins.push({
      name: 'contact-readiness-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/contact-readiness-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
        build.onLoad({ filter: /src\/components\/hooks\/use-account\.js$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace("from '#services/contacts.js'", "from '../../../tests/browser/fixtures/contact-readiness.js'")
            .replace("from '#services/private-chats.js'", "from '../../../tests/browser/fixtures/contact-readiness.js'"),
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'contact-readiness-test', name: 'Contact readiness test' })
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
    await browser.until(() => evaluate(`contactBoot.account.personFor('${peer}').saved === true`), 'contact persisted')
    await evaluate(`napp.eventStore.addPersonalCopy({kind:9,created_at:Math.floor(Date.now()/1000),tags:[],content:'Local peer history'}, {context:'dm:${peer}'})`)
    const mediaRoot = await evaluate(`contactBoot.seedCachedMedia('${peer}')`)
    const video = { bytes: [...await readFile(path.join(root, 'tests/browser/fixtures/media/vp9.webm'))], name: 'cached-video.webm', type: 'video/webm' }
    await evaluate(`contactBoot.seedCachedMedia('${peer}', ${JSON.stringify(video)})`)
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj <</Type /Catalog>> endobj\n%%EOF\n')
    await evaluate(`contactBoot.seedCachedMedia('${peer}', ${JSON.stringify({ bytes: [...pdf], name: 'cached-document.pdf', type: 'application/pdf', unknownSize: true })})`)
    await browser.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads, eventsEnabled: true })
    const reload = async () => {
      await browser.evaluate(`(() => {
        const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)});
        const url = new URL(frame.src); url.pathname = '/chat/${peer}'; url.search = '?holdOutbox=1&holdContacts=1'; frame.src = url.href;
      })()`)
      await browser.until(() => evaluate('contactBoot.queueStarted && contactBoot.contactReads === 1 && !!document.querySelector(".chat-composer")'), 'local contact snapshot while transport remains blocked')
    }
    await reload()
    assert.equal(await evaluate('contactBoot.queueFinished'), false)
    assert.equal(await evaluate('contactBoot.account.contactsState$() === "loading"'), true)
    assert.equal(await evaluate('contactBoot.negativeFrames'), 0)
    assert.match(await evaluate('document.querySelector(".chat-date").textContent'), /Loading conversation/)
    await evaluate(`(() => {
      const input = document.querySelector('.chat-composer textarea'); input.value = 'Waiting draft'; input.dispatchEvent(new Event('input', {bubbles:true}));
      document.querySelector('.compose-action').click();
    })()`)
    assert.equal(await evaluate('document.querySelector(".compose-action").getAttribute("aria-disabled")'), 'true')
    await browser.until(() => evaluate(`contactBoot.account.conversations$()['${peer}']?.historyLoaded`), 'local peer history independent of transport')
    assert.equal(await evaluate(`contactBoot.account.conversations$()['${peer}'].messages.some(m => m.content === 'Waiting draft')`), false)
    await browser.until(() => evaluate('!!document.querySelector(".chat-attachment") && contactBoot.mediaStates.length > 0'), 'cached peer attachment mounted during initialization')
    assert.equal(await evaluate('contactBoot.transferFrames'), 0, 'startup must not present a download or retry action')
    await evaluate('contactBoot.failContacts()')
    await browser.until(() => evaluate('document.querySelector(".chat-date").textContent.includes("Could not load conversation") && !!document.querySelector(".chat-date .retry-btn")'), 'unavailable membership offers retry')
    assert.equal(await evaluate('contactBoot.negativeFrames'), 0)
    assert.equal(await evaluate('document.querySelector(".compose-action").getAttribute("aria-disabled")'), 'true')
    await evaluate('document.querySelector(".chat-date .retry-btn").click()')
    await browser.until(() => evaluate('contactBoot.contactReads === 2'), 'retry rereads local contact snapshots')
    await evaluate('contactBoot.releaseContacts()')
    await browser.until(() => evaluate('document.querySelector(".compose-action").getAttribute("aria-disabled") === "false"'), 'confirmed contact enables composer')
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Waiting draft')
    assert.equal(await evaluate('contactBoot.negativeFrames'), 0)
    assert.equal(await evaluate('contactBoot.queueFinished'), false, 'contact decision does not await the outbox')
    console.log('Local contact decision while transport is held:', await evaluate('contactBoot.contactsMs'), 'ms')
    await browser.until(() => evaluate(`contactBoot.mediaStates.some(state => state.root === '${mediaRoot}' && state.status === 'complete')`), 'cached original completes while transport remains blocked', 5000)
    const attachment = name => `[...document.querySelectorAll('.route-page[data-active=true] .chat-attachment')].find(node => node.textContent.includes('${name}'))`
    const photo = attachment('cached-photo.png')
    const movie = attachment('cached-video.webm')
    await evaluate(`${photo}.scrollIntoView({block:'center'})`)
    await browser.until(() => evaluate(`${photo}?.querySelector('img:not(.attachment-placeholder)')?.src.startsWith('https://nostr.alt/') && ${photo}.querySelector('img:not(.attachment-placeholder)').naturalWidth === 320`), 'cached photo original renders while transport is blocked')
    await evaluate(`${photo}.querySelector('.attachment-frame').click()`)
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .viewer-asset[data-current=true] img")?.naturalWidth'), 'photo click opens a loaded media viewer without transport')
    await evaluate('document.querySelector(".route-page[data-active=true] .viewer-close").click()')
    await browser.until(() => evaluate(`!!${movie}`), 'return to cached video bubble')
    await evaluate(`${movie}.scrollIntoView({block:'center'})`)
    await browser.until(() => evaluate(`${movie}?.querySelector('video')?.src.startsWith('https://nostr.alt/')`), 'cached original video is available without transport')
    await evaluate(`(() => { const video = ${movie}.querySelector('video'); video.muted = true; return video.play(); })()`)
    await browser.until(() => evaluate(`${movie}.querySelector('video').currentTime > 0`), 'cached video playback advances without transport')
    await evaluate(`${movie}.querySelector('.media-expand').click()`)
    await browser.until(() => evaluate('document.querySelector(".route-page[data-active=true] .viewer-asset[data-current=true] video")?.readyState >= 2'), 'video expands into loaded media viewer without transport')
    await evaluate('document.querySelector(".route-page[data-active=true] .viewer-close").click()')
    const document = attachment('cached-document.pdf')
    await browser.until(() => evaluate(`!!${document}?.querySelector('.attachment-download')?.getAttribute('href')`), 'cached PDF has a native download link without transport')
    await evaluate(`${document}.querySelector('.attachment-download').click()`)
    await browser.until(async () => { try { return (await readFile(path.join(downloads, 'cached-document.pdf'))).equals(pdf) } catch { return false } }, 'native browser download writes exact cached PDF bytes', 10000)
    assert.equal(await evaluate('contactBoot.queueFinished'), false, 'originals, viewer and native downloads all work before transport initialization finishes')
    console.log('Cached photo/video originals, both viewer clicks and native PDF download verified with transport held')
    await evaluate('contactBoot.releaseQueue()')
    await browser.until(() => evaluate('contactBoot.queueFinished'), 'transport released')
    assert.equal(await evaluate('contactBoot.transferFrames'), 0, 'local cache hits never flash transfer actions or progress')
    await evaluate(`contactBoot.account.setContact('${peer}', false)`)
    await browser.until(() => evaluate('!!document.querySelector(".contact-invitation") && !document.querySelector(".chat-composer")'), 'confirmed removal blocks sending')
    await reload()
    assert.equal(await evaluate('contactBoot.negativeFrames'), 0, 'unknown membership is neutral even for an actual noncontact')
    await evaluate('contactBoot.releaseContacts()')
    await browser.until(() => evaluate('!!document.querySelector(".contact-invitation") && !!document.querySelector(".contact-profile")'), 'noncontact invitation follows the completed local decision')
    assert.equal(await evaluate('!!document.querySelector(".compose-action")'), false)
    await evaluate('contactBoot.releaseQueue()')
    await browser.evaluate(`(() => {
      const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)});
      const url = new URL(frame.src); url.pathname = '/chat/${peer}'; url.search = '?holdContactWrite=1'; frame.src = url.href;
    })()`)
    await browser.until(() => evaluate('!!document.querySelector(".contact-invitation button")'), 'noncontact invitation for the busy check')
    const idleBackground = await evaluate('getComputedStyle(document.querySelector(".contact-invitation button")).backgroundColor')
    await evaluate('document.querySelector(".contact-invitation button").click()')
    await browser.until(() => evaluate('contactBoot.contactWriteStarted'), 'contact write pending')
    await browser.until(() => evaluate('document.querySelector(".contact-invitation button").disabled'), 'add contact disables while busy')
    assert.equal(await evaluate('document.querySelector(".contact-invitation button").getAttribute("aria-busy")'), 'true', 'add contact reports busy')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".contact-invitation button")).pointerEvents'), 'none', 'add contact ignores presses while busy')
    assert.notEqual(await evaluate('getComputedStyle(document.querySelector(".contact-invitation button")).backgroundColor'), idleBackground, 'add contact dims its background while busy')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".contact-invitation .contact-action-content")).animationName'), 'z-contact-invitation-pulse', 'add contact content pulses while busy')
    await evaluate('contactBoot.releaseContactWrite()')
    await browser.until(() => evaluate('!document.querySelector(".contact-invitation")'), 'gated contact write completes')
  } catch (error) {
    for (const context of browser?.contexts.values() || []) {
      if (!/^http:\/\/[0-9]+\.localhost/.test(context.origin) || !context.auxData?.isDefault) continue
      console.log('Contact readiness diagnostic:', await browser.evaluate('({ state: contactBoot.account?.contactsState$(), ready: contactBoot.account?.ready$(), signer: contactBoot.account?.signerState$(), contacts: contactBoot.account?.contacts$().length, negativeFrames: contactBoot.negativeFrames, media: contactBoot.mediaStates, text: document.querySelector(".chat-composer textarea")?.value })', context.origin).catch(() => null))
      break
    }
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/contact-readiness'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
    await rm(downloads, { recursive: true, force: true })
  }
})
