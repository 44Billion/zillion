import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { finalizeEvent } from 'libp2r2p/event'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('shared profiles recover rate limits and reorder contacts without a reload', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ sourceMaps: false, onEnd: result => { files = result } })
    options.entryPoints[0] = { in: 'tests/browser/fixtures/profile-recovery-entry.js', out: 'app' }
    await esbuild.build(options)
    const html = files.find(file => file.name === 'index.html')
    html.bytes = new TextEncoder().encode(new TextDecoder().decode(html.bytes).replaceAll('z-app', 'z-profile-recovery-fixture'))
    const app = await prepareTestApp(files, { identifier: 'profile-recovery-test', name: 'Profile recovery test' })
    browser = await launchChrome({
      intercept: request => {
        const { hostname } = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(hostname)) return null
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(hostname)) return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        if (hostname === 'profile-images.example') return { responseCode: 200, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'image/png' }], body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4VQAAAAASUVORK5CYII=' }
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
    await browser.until(() => evaluate('profileRecovery.account.contactsState$() === "loaded"'), 'initial local contacts')
    const secrets = [generateSecretKey(), generateSecretKey(), generateSecretKey()]
    const peers = secrets.map(getPublicKey)
    const profiles = secrets.map((secret, index) => finalizeEvent({
      kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [],
      content: JSON.stringify({ name: ['Aaron', 'Mona', 'Pinned'][index], picture: 'https://profile-images.example/avatar.png' })
    }, secret))
    await evaluate(`profileRecovery.state.peer = '${peers[0]}'; profileRecovery.state.profiles = ${JSON.stringify(profiles)}; profileRecovery.state.releaseAt = Date.now() + 12000`)
    for (const secret of secrets.slice(1)) {
      const list = finalizeEvent({ kind: 10002, created_at: profiles[0].created_at, tags: [['r', 'wss://healthy-profiles.example']], content: '' }, secret)
      await evaluate(`dmTest.events.set('${list.id}', ${JSON.stringify(list)})`)
    }
    for (const peer of peers) await evaluate(`profileRecovery.account.setContact('${peer}', true)`)
    await evaluate(`profileRecovery.account.setPinned('${peers[2]}', true)`)
    const selector = `.contact-item[data-contact-id="${peers[0]}"]`
    await browser.until(() => evaluate(`document.querySelector('${selector} .contact-name')?.textContent.startsWith('npub1')`), 'missing profile fallback')
    const before = await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${peers[0]}').length`)
    assert.ok(before > 0)
    // Mount two independent remote-capable avatars for the same pending peer.
    // They must share the contact lookup and its existing cooldown.
    await evaluate(`(() => {
      const host = document.createElement('div'); host.id = 'duplicate-avatars';
      document.body.append(host); profileRecovery.mountAvatars(host, '${peers[0]}');
    })()`)
    await browser.until(() => evaluate(`profileRecovery.account.directory$()['${peers[1]}']?.name === 'Mona'`), 'other profiles remain available')
    const initialOrder = await evaluate('Array.from(document.querySelectorAll(\'.route-page[data-active=true] .contact-item\')).map(item => item.dataset.contactId)')
    assert.ok(initialOrder.indexOf(peers[0]) > initialOrder.indexOf(peers[1]))
    await browser.until(() => evaluate(`document.querySelector('${selector} .contact-name')?.textContent === 'Aaron'`), 'automatic profile recovery', 30000)
    const ordered = await evaluate('Array.from(document.querySelectorAll(\'.route-page[data-active=true] .contact-item\')).map(item => item.dataset.contactId)')
    assert.equal(ordered[0], peers[2], 'pin stays first')
    assert.ok(ordered.indexOf(peers[0]) < ordered.indexOf(peers[1]), 'recovered name changes alphabetical position')
    const attempts = await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${peers[0]}')`)
    const releaseAt = await evaluate('profileRecovery.state.releaseAt')
    assert.ok(attempts.some(attempt => attempt.at >= releaseAt))
    for (const relay of new Set(attempts.map(attempt => attempt.relay))) {
      const requests = attempts.filter(attempt => attempt.relay === relay)
      assert.equal(requests.filter(attempt => attempt.at < releaseAt).length, 1, 'one initial query per relay during cooldown')
    }
    await browser.until(() => evaluate(`Array.from(document.querySelectorAll('${selector} img')).some(image => image.naturalWidth > 0)`), 'recovered avatar bytes')
    const cached = await evaluate(`window.napp.eventStore.query({ kinds: [0], authors: ['${peers[0]}'] })`)
    assert.equal(cached.results[0].id, profiles[0].id)
    const count = attempts.length
    await evaluate('document.querySelector("#duplicate-avatars").remove()')
    await evaluate(`profileRecovery.account.loadPerson('${peers[0]}')`)
    assert.equal(await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${peers[0]}').length`), count)
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/profile-recovery'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
