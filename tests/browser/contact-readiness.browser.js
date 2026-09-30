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

test('direct peer routes wait for local contact membership without waiting for transport recovery', { timeout: 120000 }, async () => {
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
    await evaluate('contactBoot.releaseQueue()')
    await browser.until(() => evaluate('contactBoot.queueFinished'), 'transport released')
    await evaluate(`contactBoot.account.setContact('${peer}', false)`)
    await browser.until(() => evaluate('!!document.querySelector(".contact-invitation") && !document.querySelector(".chat-composer")'), 'confirmed removal blocks sending')
    await reload()
    assert.equal(await evaluate('contactBoot.negativeFrames'), 0, 'unknown membership is neutral even for an actual noncontact')
    await evaluate('contactBoot.releaseContacts()')
    await browser.until(() => evaluate('!!document.querySelector(".contact-invitation") && !!document.querySelector(".contact-profile")'), 'noncontact invitation follows the completed local decision')
    assert.equal(await evaluate('!!document.querySelector(".compose-action")'), false)
    await evaluate('contactBoot.releaseQueue()')
  } catch (error) {
    for (const context of browser?.contexts.values() || []) {
      if (!/^http:\/\/[0-9]+\.localhost/.test(context.origin) || !context.auxData?.isDefault) continue
      console.log('Contact readiness diagnostic:', await browser.evaluate('({ state: contactBoot.account?.contactsState$(), ready: contactBoot.account?.ready$(), signer: contactBoot.account?.signerState$(), contacts: contactBoot.account?.contacts$().length, negativeFrames: contactBoot.negativeFrames, text: document.querySelector(".chat-composer textarea")?.value })', context.origin).catch(() => null))
      break
    }
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/contact-readiness'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
