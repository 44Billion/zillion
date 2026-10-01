import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('send failures show actionable toasts only for the originating active chat', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ sourceMaps: false, onEnd: result => { files = result } })
    options.entryPoints[0] = { in: 'tests/browser/fixtures/send-feedback-entry.js', out: 'app' }
    await esbuild.build(options)
    const html = files.find(file => file.name === 'index.html')
    html.bytes = new TextEncoder().encode(new TextDecoder().decode(html.bytes).replaceAll('z-app', 'z-send-feedback-fixture'))
    const app = await prepareTestApp(files, { identifier: 'send-feedback-test', name: 'Send feedback test' })
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
    await browser.until(() => evaluate('sendTest.account.contactsState$() === "loaded"'), 'initial local contacts')
    const peer = getPublicKey(generateSecretKey())
    await evaluate(`sendTest.account.setContact('${peer}', true)`)
    const push = async url => {
      await evaluate(`testNavigation.pushState({}, '', ${JSON.stringify(url)})`)
      await browser.until(() => evaluate(`location.pathname + location.search === ${JSON.stringify(url)} && Boolean(document.querySelector('.route-page[data-active=true] main')) && !document.querySelector('[data-transitioning]')`), 'active route')
    }
    const chat = '.route-page[data-active=true] .chat-screen'
    const messages = () => evaluate(`sendTest.account.conversations$()['${peer}']?.messages || []`)
    const send = async text => {
      await evaluate(`(() => {
        const input = document.querySelector('${chat} textarea'); input.value = ${JSON.stringify(text)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()`)
      await browser.until(() => evaluate(`document.querySelector('${chat} .compose-action')?.getAttribute('aria-disabled') === 'false'`), 'composer can send')
      await evaluate(`document.querySelector('${chat} .compose-action').click()`)
      return browser.until(async () => (await messages()).find(message => message.content === text)?.id, 'optimistic bubble')
    }
    const failed = id => browser.until(async () => (await messages()).find(message => message.id === id)?.status === 'error', 'failed bubble')
    const toast = () => evaluate('document.querySelector(\'.toast-card.is-open .toast-message\')?.textContent || \'\'')
    const dismiss = async () => {
      await evaluate('sendTest.closeToast()')
      await browser.until(() => evaluate('!document.querySelector(".toast-card")'), 'toast closed')
    }
    await push(`/chat/${peer}`)
    await evaluate('dmTest.rejectionReason = \'blocked: only accepts some kinds that support public mentions well\'')
    const first = await send('Rejected active send')
    await failed(first)
    await browser.until(async () => (await toast()).includes('access rules'), 'friendly blocked toast')
    assert.equal(await evaluate('document.querySelector(".toast-message").textContent.includes("blocked:")'), false)
    // The message keeps its failed state independently of the toast.
    assert.equal(await evaluate(`!!document.querySelector('[data-message-id="${first}"] .message-status[data-status=error]')`), true)
    await dismiss()

    // Retry through the same menu the user sees, with a different relay code.
    await evaluate(`dmTest.rejectionReason = 'rate-limited: slow down'; document.querySelector('[data-message-id="${first}"] .status-indicator').click()`)
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .message-retry")'), 'retry menu')
    await evaluate('document.querySelector(".route-page[data-active=true] .message-retry").click()')
    await browser.until(async () => (await toast()).includes('Wait a moment'), 'retry guidance')
    await dismiss()

    await evaluate("dmTest.rejectionReason = 'auth-required: authenticate'; dmTest.holdAcknowledgements = true")
    const second = await send('Failure after leaving')
    await browser.until(() => evaluate('dmTest.pendingAcknowledgements() > 0'), 'held relay response')
    const originalRoute = await evaluate('testNavigation.route$().uid')
    await push('/chat/user')
    assert.equal(await evaluate(`!!document.querySelector('.route-page[data-active=false] [data-message-id="${second}"]')`), true, 'originating chat remains mounted')
    await evaluate('dmTest.holdAcknowledgements = false; dmTest.releaseAcknowledgements()')
    await failed(second)
    assert.equal(await toast(), '', 'hidden retained route does not notify')
    await evaluate('testNavigation.back()')
    await browser.until(() => evaluate(`testNavigation.route$().uid === ${originalRoute} && !document.querySelector('[data-transitioning]')`), 'back to originating chat')
    assert.equal(await toast(), '', 'returning does not replay the failure')

    await evaluate('dmTest.holdAcknowledgements = true')
    const third = await send('Failure at the same URL in a new route entry')
    await browser.until(() => evaluate('dmTest.pendingAcknowledgements() > 0'), 'held second response')
    await push('/')
    await push(`/chat/${peer}`)
    assert.notEqual(await evaluate('testNavigation.route$().uid'), originalRoute)
    await evaluate('dmTest.holdAcknowledgements = false; dmTest.releaseAcknowledgements()')
    await failed(third)
    assert.equal(await toast(), '', 'same pathname does not transfer ownership to a new route entry')

    // A fresh send from the replacement route is still eligible.
    const fourth = await send('Active authentication failure')
    await failed(fourth)
    await browser.until(async () => (await toast()).includes('require authentication'), 'new route owns new sends')
    const setLocale = locale => browser.evaluate(`(() => {
      const value = JSON.stringify(${JSON.stringify(locale)});
      localStorage.setItem('config_locale', value);
      window.dispatchEvent(new StorageEvent('storage', { key: 'config_locale', newValue: value, storageArea: localStorage }));
    })()`)
    await setLocale('pt-BR')
    await browser.until(async () => (await toast()).includes('exigem autenticação'), 'toast translates live')
    await dismiss()
    await evaluate("dmTest.rejectionReason = ''")
    const success = await send('Successful send stays quiet')
    await browser.until(async () => (await messages()).find(message => message.id === success)?.status === 'saved', 'accepted send')
    assert.equal(await toast(), '')
    console.log('Active send, retry, hidden retained chat, Back, replacement route, locale and successful send verified')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/send-feedback'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
