import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { finalizeEvent } from 'libp2r2p/event'
import { CUSTOM_APP_DATA } from 'libp2r2p/kind'
import { compile, buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const launcherOrigin = 'http://localhost:10000'
const vaultOrigin = 'http://localhost:4000'
const imageUrl = 'https://zillion-fixture.invalid/avatar.png'
const imageBytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII='

async function testBuild () {
  const files = await compile()
  const options = buildOptions({ development: true, onEnd: extra => files.push(...extra.filter(file => file.name !== '.well-known/napp.json')) })
  options.entryPoints = [{ in: 'tests/browser/fixture.js', out: '__tests__/fixture' }]
  options.entryNames = '[dir]/[name]'
  await esbuild.build(options)
  files.push({ name: '__tests__/index.html', bytes: new TextEncoder().encode('<!doctype html><html><head><script type="module" src="/__tests__/fixture.js"></script></head><body><z-browser-fixture></z-browser-fixture></body></html>') })
  return prepareTestApp(files, { identifier: 'zillion-test', name: 'Zillion test' })
}

async function withPermissions (browser, expression, origin) {
  const state = { finished: false }
  const result = browser.evaluate(expression, origin).finally(() => { state.finished = true })
  result.catch(() => {})
  while (!state.finished) {
    await browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return result
}

test('real runtime APIs and cached data survive an offline document reload', { timeout: 180000 }, async () => {
  const runtimeLog = []
  const runtime = await ensureRuntime({ log: text => runtimeLog.push(text) })
  let browser
  let offline = false
  let imageRequests = 0
  const runId = randomUUID()
  try {
    const app = await testBuild()
    browser = await launchChrome({
      intercept: request => {
        const url = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(url.hostname)) return null
        if (offline) return false
        if (request.url === imageUrl) {
          imageRequests++
          return { responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: imageBytes }
        }
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(url.hostname)) {
          return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        }
        return false
      }
    })
    await browser.navigate(launcherOrigin)
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
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

    await browser.evaluate(app.installExpression)
    await browser.navigate(`${launcherOrigin}/${app.app}`)
    const appOrigin = await browser.until(async () => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(appOrigin).origin
    await browser.until(() => browser.evaluate('document.querySelector("z-app h1")?.textContent === "Zillion"', origin), 'published app entry')
    // Reloading the launcher also reloads the vault; unlock through its real UI.
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')
    await browser.evaluate('location.href = "/__tests__/index.html"', origin)
    await browser.until(() => browser.evaluate('Boolean(window.__zillionTest?.view)', origin), 'browser fixture')
    assert.equal(await browser.evaluate('__zillionTest.injectedBeforeEntry', origin), true)
    assert.equal(await browser.evaluate('__zillionTest.identity', origin), pubkey)
    assert.equal(typeof await browser.evaluate('__zillionTest.locale', origin), 'string')

    const profileKey = generateSecretKey()
    const profile = finalizeEvent({ kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [], content: JSON.stringify({ name: 'Offline Alice', picture: imageUrl }) }, profileKey)
    await withPermissions(browser, `window.napp.eventStore.add(${JSON.stringify(profile)})`, origin)
    await withPermissions(browser, `__zillionTest.view.pk$(${JSON.stringify(profile.pubkey)}); __zillionTest.getProfile(${JSON.stringify(profile.pubkey)})`, origin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("a-avatar img")?.src.startsWith("data:image") && document.querySelector("a-avatar img").naturalWidth > 0)', origin), 'cached avatar')
    assert.equal(imageRequests, 1)
    const instance = await browser.evaluate('window.napp.getInstanceMetadata()', origin)
    const coordinate = `zillion:test:${runId}:${instance.instanceKey}`
    const now = Math.floor(Date.now() / 1000)
    const checkpoint = { kind: CUSTOM_APP_DATA, created_at: now, tags: [['d', coordinate], ['expiration', String(now + 86400)]], content: JSON.stringify({ step: 'before-reload', expected: profile.id }) }
    await withPermissions(browser, `window.nostr.signEvent(${JSON.stringify(checkpoint)}).then(event => window.napp.eventStore.add(event))`, origin)
    const updated = { ...checkpoint, created_at: now + 1, content: JSON.stringify({ step: 'updated', expected: profile.id }) }
    await withPermissions(browser, `window.nostr.signEvent(${JSON.stringify(updated)}).then(event => window.napp.eventStore.add(event))`, origin)
    const token = await browser.evaluate('__zillionTest.token', origin)
    offline = true
    await browser.evaluate('location.reload()', origin)
    await browser.until(() => browser.evaluate(`Boolean(window.__zillionTest && __zillionTest.token !== ${JSON.stringify(token)})`, origin), 'new document')
    const query = { kinds: [CUSTOM_APP_DATA], '#d': [coordinate] }
    const stored = await withPermissions(browser, `window.napp.eventStore.query(${JSON.stringify(query)})`, origin)
    assert.equal(stored.results.length, 1)
    assert.equal(JSON.parse(stored.results[0].content).expected, profile.id)
    assert.equal(JSON.parse(stored.results[0].content).step, 'updated')
    assert.equal(stored.results[0].created_at, now + 1)
    assert.equal(stored.results[0].tags.find(tag => tag[0] === 'expiration')[1], String(now + 86400))
    const recovered = await withPermissions(browser, `__zillionTest.getProfile(${JSON.stringify(profile.pubkey)})`, origin)
    assert.equal(recovered.name, 'Offline Alice')
    await browser.evaluate(`__zillionTest.view.pk$(${JSON.stringify(profile.pubkey)})`, origin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("a-avatar img")?.src.startsWith("data:image") && document.querySelector("a-avatar img").naturalWidth > 0)', origin), 'offline avatar')
    assert.equal(imageRequests, 1)
    const missingProfile = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ picture: 'https://zillion-fixture.invalid/missing.png' }) }, generateSecretKey())
    await withPermissions(browser, `window.napp.eventStore.add(${JSON.stringify(missingProfile)})`, origin)
    await browser.evaluate(`__zillionTest.view.pk$(${JSON.stringify(missingProfile.pubkey)})`, origin)
    await browser.until(() => browser.evaluate('!document.querySelector("a-avatar img") && Boolean(document.querySelector("a-avatar svg"))', origin), 'offline fallback')
  } catch (error) {
    console.error(error)
    const artifacts = path.join(root, 'tmp/browser-failures', runId)
    await browser?.diagnose(artifacts)
    console.error(`Browser diagnostics: ${artifacts}`)
    if (!browser) console.error(runtimeLog.join('').slice(-3000))
    throw error
  } finally {
    await browser?.close(); await runtime.close(); esbuild.stop()
  }
})
