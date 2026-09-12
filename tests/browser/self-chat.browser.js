import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

const launcherOrigin = 'http://localhost:10000'
const vaultOrigin = 'http://localhost:4000'

test('real self chat persists offline, quotes inner IDs and receives event-store updates', { timeout: 180000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  let offline = true
  try {
    const app = await prepareTestApp(await compile(), { identifier: 'self-chat-test', name: 'Self chat test' })
    browser = await launchChrome({
      intercept: request => {
        const url = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(url.hostname)) return null
        if (offline) return false
        if (request.url === 'https://example.com/photo.png') {
          return {
            responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII='
          }
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
    assert.equal(await evaluate('document.querySelectorAll(".chat-bubble").length'), 0)
    const setText = text => evaluate(`(() => { const input = document.querySelector('.chat-composer textarea'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await setText('Today\nhttps://example.com/photo.png #private')
    await browser.until(() => evaluate('document.querySelector(".compose-action").getAttribute("aria-disabled") === "false"'), 'enabled Send')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 1'), 'saved message', 45000)
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").value === ""'), 'draft cleared after save')
    await browser.until(() => evaluate('Boolean(document.querySelector(".chat-media a"))'), 'media link')
    assert.equal(await evaluate('document.querySelector(".chat-media a").href'), 'https://example.com/photo.png')
    assert.equal(await evaluate('document.querySelector(".chat-media img")'), null, 'uncached offline image stays a link')
    const id = await evaluate('document.querySelector(".message-row").dataset.messageId')
    await evaluate('document.querySelector(".chat-bubble").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))')
    await browser.until(() => evaluate('Boolean(document.querySelector(".message-actions"))'), 'message actions')
    await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
    await browser.until(() => evaluate('Boolean(document.querySelector(".composer-reply"))'), 'reply preview')
    await setText('Reply to my note')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 2'), 'saved reply')
    assert.equal(await evaluate('document.querySelectorAll(".message-quote").length'), 1)
    const readMessages = `window.napp.eventStore.query({ kinds: [1006], '#k': ['9'] }).then(async ({ results }) => Promise.all(results.map(async wrapper => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob((await window.nostr.nip44v3.decrypt(${JSON.stringify(pubkey)}, '9', '', wrapper.content)).replaceAll('-', '+').replaceAll('_', '/')), char => char.charCodeAt(0)))))))`
    const events = await evaluate(readMessages)
    assert.deepEqual(events.find(event => event.content === 'Reply to my note').tags.find(tag => tag[0] === 'q'), ['q', id, '', pubkey])
    assert.equal((await evaluate('window.napp.eventStore.query({ kinds: [9] })')).results.length, 0, 'no public chat copies')
    await evaluate(`window.napp.eventStore.addPersonalCopy({ kind: 9, created_at: Math.floor(Date.now()/1000), tags: [], content: 'Arrived through the store' }, { context: ${JSON.stringify(`dm:${pubkey}`)} })`)
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 3'), 'live store message')
    await evaluate('window.napp.eventStore.addPersonalCopy({ kind: 9, created_at: Math.floor(Date.now()/1000), tags: [], content: \'Generic private data\' }, { context: \'\' })')
    assert.equal(await evaluate('document.querySelectorAll(".chat-bubble").length'), 3)
    await evaluate('location.reload()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 3'), 'offline history after reload', 45000)
    assert.ok(await evaluate('document.querySelector(".chat-timeline").innerText.includes("Today")'))
    assert.equal(await evaluate('document.querySelectorAll(".message-quote").length'), 1)
    offline = false
    await evaluate('window.dispatchEvent(new Event("online"))')
    await browser.until(() => evaluate('document.querySelector(".chat-media img")?.naturalWidth > 0'), 'image renders after connectivity returns', 30000)
    offline = true
    await evaluate('location.reload()')
    await browser.until(() => evaluate('document.querySelector(".chat-media img")?.naturalWidth > 0'), 'cached image remains available offline', 30000)
    await evaluate('document.querySelector(".chat-back").click()')
    await browser.until(() => evaluate('location.pathname === "/"'), 'home navigation')
    await browser.until(() => evaluate('document.querySelector(".conversation [data-contact-id=user] .preview").textContent.length > 0'), 'real self preview')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/self-chat'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
