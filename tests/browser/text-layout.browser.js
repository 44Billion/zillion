import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const launcherOrigin = 'http://localhost:10000'
const vaultOrigin = 'http://localhost:4000'

test('text-only history keeps the height and both edges of the latest bubbles stable', { timeout: 180000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    const files = await compile({ development: true })
    const script = files.find(file => file.name === 'app.js')
    const probe = await readFile(new URL('./fixtures/text-layout-probe.js', import.meta.url), 'utf8')
    // Instrument every new app document without replacing its runtime APIs.
    script.bytes = new TextEncoder().encode(probe + new TextDecoder().decode(script.bytes))
    const app = await prepareTestApp(files, { identifier: 'text-layout-test', name: 'Text layout test' })
    browser = await launchChrome()
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
    const appUrl = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(appUrl).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    permissions = setInterval(() => browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {}), 100)
    // Reloading the launcher also reloads the vault; unlock through its real UI.
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')

    await browser.until(() => evaluate('Boolean(document.querySelector(".conversation [data-contact-id=user]"))'), 'self conversation')
    await evaluate('document.querySelector(".conversation [data-contact-id=user]").click()')
    await browser.until(() => evaluate('document.querySelector(".chat-header h1")?.textContent === "You"'), 'real self chat')

    const pageSession = [...browser.contexts.values()].find(context => context.origin === launcherOrigin && context.auxData?.isDefault).sessionId
    const timestamp = Math.floor(Date.now() / 1000)
    const texts = ['Antepenúltima', 'Mais uma', '?']
    for (let i = 0; i < 30; i++) {
      const content = i >= 27 ? texts[i - 27] : `History without links ${i}\nSecond line`
      const saved = await evaluate(`window.napp.eventStore.addPersonalCopy({kind:9, created_at:${timestamp + i}, tags:[], content:${JSON.stringify(content)}}, {context:${JSON.stringify(`dm:${pubkey}`)}})`)
      assert.equal(saved.result.ok, true)
    }
    await browser.until(() => evaluate('document.querySelectorAll(".message-row").length === 30'), 'text-only history persisted')
    for (const [width, deviceScaleFactor] of [[390, 1], [718, 1.25], [320, 2]]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 780, deviceScaleFactor, mobile: true }, pageSession)
      const token = await evaluate('textLayoutProbe.token')
      await evaluate('location.reload()')
      await browser.until(() => evaluate(`window.textLayoutProbe && textLayoutProbe.token !== ${JSON.stringify(token)}`), 'new app document')
      await browser.until(() => evaluate('document.querySelectorAll(".message-row").length === 30 && document.querySelector(".chat-timeline").dataset.initialLoading === "false"'), 'text history fully processed', 60000)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const frames = await evaluate('textLayoutProbe.frames')
      for (const text of texts) {
        const samples = frames.filter(frame => frame.pinned).flatMap(frame => frame.bubbles.filter(bubble => bubble.text === text))
        assert.ok(new Set(samples.map(sample => sample.count)).size >= 5, 'sample multiple history insertions after reaching the bottom')
        for (const property of ['height', 'top', 'bottom']) {
          const values = samples.map(sample => sample[property])
          const spread = Math.max(...values) - Math.min(...values)
          assert.ok(spread <= 0.04, `${JSON.stringify(text)} ${property} varied ${spread}px at width ${width}, scale ${deviceScaleFactor}`)
        }
      }
      assert.ok(frames.every(frame => frame.animations === 0), 'plain text history never starts enrichment animations')
    }
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/text-layout'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
