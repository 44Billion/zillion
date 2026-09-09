import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { prepareLocalApp } from '../../../../44billion/bin/local-app.js'
import { launcherRoot, ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { finalizeEvent } from 'libp2r2p/event'
import { CUSTOM_APP_DATA } from 'libp2r2p/kind'
import { compile, buildOptions, root } from '../../bin/build-options.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const launcherOrigin = 'http://localhost:10000'
const vaultOrigin = 'http://localhost:4000'
const imageUrl = 'https://zillion-fixture.invalid/avatar.png'
const imageBytes = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII='

async function testBuild (localSecret) {
  const files = await compile()
  const options = buildOptions({ development: true, onEnd: extra => files.push(...extra.filter(file => file.name !== '.well-known/napp.json')) })
  options.entryPoints = [{ in: 'tests/browser/fixture.js', out: '__tests__/fixture' }]
  options.entryNames = '[dir]/[name]'
  await esbuild.build(options)
  files.push({ name: '__tests__/index.html', bytes: new TextEncoder().encode('<!doctype html><html><head><script type="module" src="/__tests__/fixture.js"></script></head><body><z-browser-fixture></z-browser-fixture></body></html>') })
  if (localSecret) return { ...prepareLocalApp(files, { secret: localSecret, identifier: 'zillion-local-test', name: 'Zillion test' }), files }
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

for (const localDevelopment of [false, true]) {
  test(`real runtime APIs and cached data survive ${localDevelopment ? 'a local build update' : 'an offline document reload'}`, { timeout: 180000 }, async () => {
    const runtimeLog = []
    const runtime = await ensureRuntime({ log: text => runtimeLog.push(text) })
    let browser
    let offline = false
    let imageRequests = 0
    const runId = randomUUID()
    try {
      const localSecret = localDevelopment ? generateSecretKey() : null
      const app = await testBuild(localSecret)
      const publishLocal = async build => {
        const { token } = JSON.parse(await readFile(path.join(launcherRoot, 'tmp/local-dev-session.json'), 'utf8'))
        const response = await fetch(`${launcherOrigin}/__dev/apps/register`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ ...build, files: undefined })
        })
        assert.equal(response.status, 200, await response.text())
      }
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

      if (localDevelopment) {
        await publishLocal(app)
        await browser.navigate(`${launcherOrigin}/?local-dev=${encodeURIComponent(app.project)}`)
      } else {
        await browser.evaluate(app.installExpression)
        await browser.navigate(`${launcherOrigin}/${app.app}`)
      }
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
      if (localDevelopment) {
        const files = app.files.map(file => file.name === '__tests__/fixture.js'
          ? { ...file, bytes: new Uint8Array([...file.bytes, ...new TextEncoder().encode('\n// Local build update\n')]) }
          : file)
        await publishLocal(prepareLocalApp(files, { secret: localSecret, identifier: 'zillion-local-test', name: 'Zillion test' }))
      } else await browser.evaluate('location.reload()', origin)
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
      assert.equal(imageRequests, 1)
      if (localDevelopment) {
        const { targetId } = await browser.send('Target.createTarget', { url: `${launcherOrigin}/${app.app}/__tests__/index.html` })
        const appContexts = () => [...browser.contexts.values()].filter(context => context.origin === origin && context.auxData?.isDefault)
        await browser.until(() => appContexts().length >= 2, 'second local app instance')
        const evaluateContext = async (context, expression) => {
          const response = await browser.send('Runtime.evaluate', { expression, contextId: context.id, returnByValue: true, awaitPromise: true }, context.sessionId, 1000)
          if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails))
          return response.result.value
        }
        const fixtureContexts = async () => (await Promise.all(appContexts().map(async context => {
          try { return await evaluateContext(context, 'Boolean(window.__zillionTest)') ? context : null } catch { return null }
        }))).filter(Boolean)
        await browser.until(async () => (await fixtureContexts()).length >= 2, 'both local fixtures')
        const tokens = await Promise.all((await fixtureContexts()).map(context => evaluateContext(context, '__zillionTest.token')))
        const nextFiles = app.files.map(file => file.name === '__tests__/fixture.js'
          ? { ...file, bytes: new Uint8Array([...file.bytes, ...new TextEncoder().encode('\n// Multi-tab update\n')]) }
          : file)
        const nextBuild = prepareLocalApp(nextFiles, { secret: localSecret, identifier: 'zillion-local-test', name: 'Zillion test' })
        await publishLocal(nextBuild)
        await browser.until(async () => {
          const contexts = await fixtureContexts()
          if (contexts.length < 2) return false
          try { return (await Promise.all(contexts.map(context => evaluateContext(context, 'window.__zillionTest?.token')))).every(value => value && !tokens.includes(value)) } catch { return false }
        }, 'both local instances updated')
        await browser.until(() => browser.evaluate(`Object.keys(JSON.parse(localStorage.getItem('local_devApps'))[${JSON.stringify(app.appId)}].versions).length === 1`), 'old local versions reclaimed')
        const launcherContext = [...browser.contexts.values()].find(context => context.origin === launcherOrigin && context.auxData?.isDefault)
        await browser.send('Page.bringToFront', {}, launcherContext.sessionId)
        const openMenu = async () => {
          await browser.send('Page.bringToFront', {}, launcherContext.sessionId)
          if (!await browser.evaluate('Boolean(document.querySelector("local-dev-reset-button button"))')) {
            await browser.evaluate(`[...document.querySelectorAll('toolbar-app-launcher')].find(element => element.props.appId === ${JSON.stringify(app.appId)}).querySelector(':scope > div').click()`)
          }
        }
        await openMenu()
        await browser.until(() => browser.evaluate('Boolean(document.querySelector("local-dev-reset-button button"))'), 'local reset menu action')
        await browser.evaluate('document.querySelector("local-dev-reset-button button").click()')
        await browser.until(() => browser.evaluate('Boolean(document.querySelector("dialog[open] #confirmation-dialog-card .deny-button:not(:disabled)"))'), 'reset confirmation')
        await browser.evaluate('document.querySelector("dialog[open] #confirmation-dialog-card .deny-button").click()')
        const beforeReset = await withPermissions(browser, `window.napp.eventStore.query(${JSON.stringify(query)})`, origin)
        assert.equal(beforeReset.results.length, 1)
        await openMenu()
        await browser.until(() => browser.evaluate('Boolean(document.querySelector("local-dev-reset-button button:not(:disabled)"))'), 'reset action enabled')
        await browser.evaluate('document.querySelector("local-dev-reset-button button").click()')
        await browser.until(() => browser.evaluate('Boolean(document.querySelector("dialog[open] #confirmation-dialog-card .confirm-button:not(:disabled)"))'), 'reset confirmation again')
        const resetTokens = await Promise.all((await fixtureContexts()).map(context => evaluateContext(context, '__zillionTest.token')))
        await browser.evaluate('document.querySelector("dialog[open] #confirmation-dialog-card .confirm-button").click()')
        await browser.until(async () => {
          const contexts = await fixtureContexts()
          if (contexts.length < 2) return false
          try { return (await Promise.all(contexts.map(context => evaluateContext(context, 'window.__zillionTest?.token')))).every(value => value && !resetTokens.includes(value)) } catch { return false }
        }, 'both fixtures resumed after reset')
        const afterReset = await withPermissions(browser, `window.napp.eventStore.query(${JSON.stringify(query)})`, origin)
        assert.equal(afterReset.results.length, 0)
        await openMenu()
        await browser.until(() => browser.evaluate('Boolean(document.querySelector("local-dev-reset-button button:not(:disabled)"))'), 'reset completed')
        assert.equal(await browser.evaluate('document.querySelector("local-dev-reset-button [role=alert]")?.textContent || ""'), '')
        assert.equal(await browser.evaluate(`JSON.parse(localStorage.getItem('local_devApps'))[${JSON.stringify(app.appId)}].version`), nextBuild.revision)
        await browser.send('Target.closeTarget', { targetId })
      }
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
}
