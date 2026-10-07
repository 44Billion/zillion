import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { finalizeEvent } from 'libp2r2p/event'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const latencyOnly = process.env.ZILLION_SEND_LATENCY_ONLY === '1'

test(latencyOnly ? 'early fallback reduces send latency and fast primaries avoid it' : 'send failures show actionable toasts only for the originating active chat', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  let offlineProbes = false
  try {
    let files
    const options = buildOptions({ sourceMaps: false, onEnd: result => { files = result } })
    options.plugins.push({
      name: 'pause-observation', setup (build) {
        build.onLoad({ filter: /private-messenger\/index\.js$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8')).replace('this.initialized = false', 'this.initialized = false; (window.pauseTestMessengers ||= []).push(this)'), loader: 'js'
        }))
      }
    })
    options.entryPoints[0] = { in: 'tests/browser/fixtures/send-feedback-entry.js', out: 'app' }
    await esbuild.build(options)
    const html = files.find(file => file.name === 'index.html')
    html.bytes = new TextEncoder().encode(new TextDecoder().decode(html.bytes).replaceAll('z-app', 'z-send-feedback-fixture'))
    const app = await prepareTestApp(files, { identifier: 'send-feedback-test', name: 'Send feedback test' })
    browser = await launchChrome({
      intercept: request => {
        const { hostname } = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(hostname)) return null
        if (offlineProbes && ['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(hostname)) return false
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(hostname)) return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        return false
      }
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
    const peerSecret = generateSecretKey()
    const peer = getPublicKey(peerSecret)
    const fallbackRelay = 'wss://relay.44billion.net'
    const readRelays = ['a', 'b', 'c', 'd', 'e'].map(name => `wss://${name}.relay-fallback.example`)
    const relayList = finalizeEvent({ kind: 10002, created_at: Math.floor(Date.now() / 1000), tags: readRelays.map(relay => ['r', relay, 'read']), content: '' }, peerSecret)
    const ownReadRelay = 'wss://own-read.relay-fallback.example'
    const ownRelayList = finalizeEvent({ kind: 10002, created_at: relayList.created_at, tags: [['r', ownReadRelay, 'read']], content: '' }, secret)
    await evaluate(`dmTest.events.set('${relayList.id}', ${JSON.stringify(relayList)}); dmTest.events.set('${ownRelayList.id}', ${JSON.stringify(ownRelayList)}); dmTest.publicationBatches = []; dmTest.subscriptionBatches = []`)
    await evaluate(`dmTest.refreshRelayLists(['${pubkey}', '${peer}'])`)
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
    if (latencyOnly) {
      // Slow primaries retain their real 30s deadline; the fallback wins around 3s.
      await evaluate(`dmTest.rejectionReasons = {}; dmTest.rejectionReason = ''; dmTest.heldRelays = ${JSON.stringify(readRelays)}; dmTest.publicationBatches = []`)
      const hedged = await send('Early fallback beats silent primaries')
      await browser.until(() => evaluate('dmTest.publicationBatches.some(batch => batch.kind === 3560)'), 'first primary publication')
      const started = Date.now()
      await browser.until(async () => (await messages()).find(message => message.id === hedged)?.status === 'saved', 'early fallback accepts silent-primary send', 12000)
      const hedgeBatches = await evaluate('dmTest.publicationBatches')
      const opening = hedgeBatches.find(batch => batch.kind === 3560)
      const alternate = hedgeBatches.find(batch => batch.id === opening.id && batch.relays.includes(fallbackRelay))
      assert.ok(alternate)
      assert.ok(alternate.at - opening.at >= 2900 && alternate.at - opening.at < 6000, 'fallback starts at the single three-second deadline')
      assert.ok(Date.now() - started < 12000, 'no primary-exhaustion wait')
      assert.equal(await toast(), '')
      await evaluate('dmTest.heldRelays = []; dmTest.releaseAcknowledgements()')
      // A healthy initial pair must accept without publishing to fallback.
      await evaluate('dmTest.publicationBatches = []')
      const fast = await send('Fast primaries skip fallback')
      await browser.until(async () => (await messages()).find(message => message.id === fast)?.status === 'saved', 'fast primary send')
      assert.equal(await evaluate(`dmTest.publicationBatches.some(batch => batch.relays.includes('${fallbackRelay}'))`), false)
      console.log('Three-second fallback, immediate primary success and unchanged signed events verified')
      return
    }
    await evaluate('dmTest.rejectionReason = \'blocked: only accepts some kinds that support public mentions well\'')
    const first = await send('Rejected active send')
    await failed(first)
    const failedBatches = await evaluate('dmTest.publicationBatches')
    const initial = failedBatches.find(batch => batch.relays.includes(readRelays[0]) && failedBatches.some(attempt => attempt.id === batch.id && attempt.relays.length === 1 && attempt.relays[0] === fallbackRelay))
    assert.ok(initial)
    const attempts = failedBatches.filter(batch => batch.id === initial.id)
    assert.deepEqual(attempts.map(batch => batch.relays), [readRelays.slice(0, 2), readRelays.slice(2, 4), [readRelays[4]], [fallbackRelay]], 'configured fallback is tried only after every advertised read relay, before the final error')
    const subscriptions = await evaluate('dmTest.subscriptionBatches')
    const watchedRelays = new Set(subscriptions.filter(batch => batch.filter.kinds?.includes(3560)).flatMap(batch => batch.relays))
    assert.deepEqual(watchedRelays, new Set([ownReadRelay, fallbackRelay]), 'primary and fallback both have private-channel subscriptions before the user send completes')
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

    // A user retry remains pending while alternate relays answer. The first
    // five read relays refuse and the configured fallback accepts the same event.
    await evaluate(`dmTest.rejectionReason = ''; dmTest.rejectionReasons = ${JSON.stringify(Object.fromEntries(readRelays.map(relay => [relay, 'blocked: unsupported kind'])))}; dmTest.heldRelays = ${JSON.stringify([fallbackRelay])}; dmTest.publicationBatches = []; document.querySelector('[data-message-id="${first}"] .status-indicator').click()`)
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .message-retry")'), 'second retry menu')
    await evaluate('document.querySelector(".route-page[data-active=true] .message-retry").click()')
    await browser.until(() => evaluate('dmTest.pendingAcknowledgements() > 0'), 'replacement relay responses held')
    assert.equal((await messages()).find(message => message.id === first)?.status, 'pending')
    assert.equal(await toast(), '', 'intermediate relay rejections never show a toast')
    const batches = await evaluate('dmTest.publicationBatches')
    const firstBatch = batches.find(batch => batch.relays.includes(readRelays[0]))
    assert.ok(firstBatch)
    assert.ok(batches.some(batch => batch.id === firstBatch.id && batch.relays.includes(fallbackRelay)), 'the configured fallback receives the same outer event ID')
    assert.ok(batches.every(batch => batch.relays.filter(relay => [...readRelays, fallbackRelay].includes(relay)).length <= 2), 'at most two recipient/fallback relays per attempt')
    assert.ok(batches.filter(batch => batch.id === firstBatch.id).every(batch => batch.kind === 3560 && !batch.tags.some(tag => tag[0] === 'p')), 'fallback never adds a public recipient p tag')
    await evaluate('dmTest.heldRelays = []; dmTest.releaseAcknowledgements()')
    await browser.until(async () => (await messages()).find(message => message.id === first)?.status === 'saved', 'replacement relay accepts the retry')
    assert.equal(await toast(), '')
    await evaluate('dmTest.rejectionReasons = {}')

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
    // Start the pause regression with a clean outbox; earlier cases intentionally
    // leave failed publications that a reconnect may retry before this message.
    await evaluate(`Promise.all(['${second}', '${third}', '${fourth}'].map(id => sendTest.account.delivery().cancel(id)))`)
    // Only remote probes are controlled. The native offline event, account,
    // messenger, encrypted outbox and event-store/vault bridges remain real.
    offlineProbes = true
    await evaluate("window.dispatchEvent(new Event('offline'))")
    const paused = await send('Pending during network pause')
    await browser.until(() => evaluate(`sendTest.account.outbox$().some(entry => entry.id === '${paused}' && entry.failed && entry.status === 'pending')`), 'paused outbox entry')
    const pausedCount = await evaluate('dmTest.publicationBatches.length')
    await new Promise(resolve => setTimeout(resolve, 2000))
    assert.equal(await evaluate('dmTest.publicationBatches.length'), pausedCount, 'a known pause does not republish blindly')
    await push('/chat/user')
    await evaluate("sendTest.account.send('Self chat stays local while paused')")
    await browser.until(() => evaluate("sendTest.account.messages$().some(message => message.content === 'Self chat stays local while paused' && message.status === 'saved')"), 'self-chat persists during network pause')
    offlineProbes = false
    // No second native online event: the shared monitor must recover on its own.
    await push(`/chat/${peer}`)
    await browser.until(async () => (await messages()).find(message => message.id === paused)?.status === 'saved', 'automatic network-pause recovery', 25000)
    assert.equal(await toast(), '')
    console.log('Send feedback, native network pause, local self-chat and recovery without a second online event verified')
  } catch (error) {
    for (const context of browser?.contexts.values() || []) {
      if (/^http:\/\/[0-9]+\.localhost:10000$/.test(context.origin)) {
        console.error('Pause state', await browser.evaluate('({ status: window.pauseTestMessengers?.map(value => value.readStatus()), signer: window.sendTest?.account.signerState$(), outbox: window.sendTest?.account.outbox$().map(({ status, failed }) => ({ status, failed })), batches: window.dmTest?.publicationBatches?.length })', context.origin).catch(() => null))
      }
    }
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/send-feedback'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
