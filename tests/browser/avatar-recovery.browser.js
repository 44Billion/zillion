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

test('home avatars recover without navigation and mobile image preparation survives fifteen seconds', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  let releaseSlow
  const requests = []
  const response = {
    responseCode: 200,
    responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'image/png' }, { name: 'Cache-Control', value: 'no-store' }],
    body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4VQAAAAASUVORK5CYII='
  }
  try {
    let files
    const options = buildOptions({ sourceMaps: false, onEnd: result => { files = result } })
    options.entryPoints[0] = { in: 'tests/browser/fixtures/profile-recovery-entry.js', out: 'app' }
    await esbuild.build(options)
    const html = files.find(file => file.name === 'index.html')
    html.bytes = new TextEncoder().encode(new TextDecoder().decode(html.bytes).replaceAll('z-app', 'z-profile-recovery-fixture'))
    const app = await prepareTestApp(files, { identifier: 'avatar-recovery-test', name: 'Avatar recovery test' })
    browser = await launchChrome({
      intercept: request => {
        const { hostname, pathname } = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(hostname)) return null
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(hostname)) return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        if (hostname !== 'avatar-recovery.example') return false
        requests.push({ path: pathname, at: Date.now() })
        if (pathname === '/retry.png' && requests.filter(item => item.path === pathname).length <= 2) return { ...response, responseCode: 503, body: '' }
        if (pathname === '/slow.png') return new Promise(resolve => { releaseSlow = () => resolve(response) })
        return response
      }
    })
    permissions = setInterval(() => browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {}), 100)
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher ready')
    const vaultOrigin = 'http://localhost:4000'
    const secret = generateSecretKey()
    const pubkey = getPublicKey(secret)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("#toolbar-active-avatar-button"))'), 'launcher toolbar')
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("account-add input") && document.querySelector("#vault").style.visibility === "visible")', vaultOrigin), 'vault UI')
    const vaultContext = [...browser.contexts.values()].find(context => context.origin === vaultOrigin && context.auxData?.isDefault)
    await browser.send('WebAuthn.enable', { enableUI: false }, vaultContext.sessionId)
    await browser.send('WebAuthn.addVirtualAuthenticator', {
      options: { protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal', hasResidentKey: true, hasUserVerification: true, hasPrf: true, isUserVerified: true, automaticPresenceSimulation: true }
    }, vaultContext.sessionId)
    await browser.evaluate('document.querySelector("create-overlay .create-dismiss")?.click(); document.querySelector("#add-account-btn").click()', vaultOrigin)
    await browser.evaluate(`document.querySelector('account-add input').value=${JSON.stringify(bytesToBase16(secret))};document.querySelector('account-add form').requestSubmit()`, vaultOrigin)
    await browser.until(async () => {
      await browser.evaluate('document.querySelector("passkey-fallback-dialog [data-choice=local]")?.click()', vaultOrigin)
      return browser.evaluate(`Boolean(document.querySelector('account-avatar[pubkey="${pubkey}"]'))`, vaultOrigin)
    }, 'imported test account', 45000)
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, browser.sessionId)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const frame = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame=>frame.src).find(src=>src.startsWith("http:")&&/^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app frame')
    const origin = new URL(frame).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    await browser.until(() => evaluate('profileRecovery.account.signerState$()?.isLocked===true'), 'locked account')
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => evaluate('profileRecovery.account.contactsState$()==="loaded"'), 'local contacts ready')
    assert.equal(await evaluate('profileRecovery.account.pubkey$()'), pubkey)
    const selector = '.route-page[data-active=true] .home .avatar-presentation'
    const stages = () => evaluate(`[...document.querySelectorAll('${selector}')].map(node=>node.dataset.avatarState)`)
    await browser.until(async () => { const state = await stages(); return state.length === 3 && state.every(value => value === 'fallback') }, 'three initial self fallbacks')
    const initialPath = await evaluate('location.pathname')
    let at = Math.floor(Date.now() / 1000)
    const profile = async picture => {
      const event = finalizeEvent({ kind: 0, created_at: at++, tags: [], content: JSON.stringify({ name: 'Own late metadata', ...(picture ? { picture: `https://avatar-recovery.example/${picture}` } : {}) }) }, secret)
      await evaluate(`window.napp.eventStore.add(${JSON.stringify(event)})`)
      await browser.until(() => evaluate(`profileRecovery.account.profile$()?.picture===${JSON.stringify(picture ? `https://avatar-recovery.example/${picture}` : undefined)}`), 'new own picture metadata delivered')
    }
    const photos = label => browser.until(async () => (await stages()).every(value => value === 'photo'), label)
    const reset = async () => {
      await profile(null)
      await browser.until(async () => (await stages()).every(value => value === 'fallback'), 'explicit removal clears all home portraits')
    }
    await evaluate(`(() => {
      const probe=window.avatarDecodeProbe={mode:null,failed:false,attempt:null,waiting:[],stages:[]};
      const nativeDecode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=function() {
        if(!this.classList.contains('avatar-candidate')||!probe.mode) return nativeDecode.call(this);
        if(probe.mode==='one') {
          if(!probe.failed) {probe.failed=true;return Promise.reject(new Error('Controlled individual decode failure'));}
          return new Promise(resolve=>probe.waiting.push(resolve)).then(()=>nativeDecode.call(this));
        }
        const attempt=profileRecovery.account.avatarSnapshot('${pubkey}').candidate.id;
        probe.attempt??=attempt;
        if(attempt===probe.attempt) return Promise.reject(new Error('Controlled first-attempt decode failure'));
        return nativeDecode.call(this);
      };
      new MutationObserver(()=>probe.stages.push(...[...document.querySelectorAll('${selector}')].map(node=>node.dataset.avatarState)))
        .observe(document.querySelector('.home'),{subtree:true,attributes:true,childList:true});
    })()`)

    await profile('retry.png')
    await photos('transient image failure recovers automatically')
    assert.equal(requests.filter(item => item.path === '/retry.png').length, 3, 'failed CORS/native attempt followed by one successful automatic retry')
    assert.equal(await evaluate('location.pathname'), initialPath)

    await reset()
    await evaluate('avatarDecodeProbe.mode="one";avatarDecodeProbe.failed=false')
    await profile('individual.png')
    await browser.until(() => evaluate('avatarDecodeProbe.waiting.length>=2'), 'other two candidates keep their decode work')
    assert.ok(await evaluate(`profileRecovery.account.avatarSnapshot('${pubkey}').candidate`), 'one failure does not remove the shared candidate')
    await evaluate('avatarDecodeProbe.mode=null;avatarDecodeProbe.waiting.splice(0).forEach(resolve=>resolve())')
    await photos('another mounted avatar confirms the source for every home portrait')
    assert.equal(requests.filter(item => item.path === '/individual.png').length, 1)

    await reset()
    await evaluate('avatarDecodeProbe.mode="all-first";avatarDecodeProbe.attempt=null')
    await profile('cached-retry.png')
    await photos('all failed candidates retry from cached bytes without navigation')
    assert.equal(requests.filter(item => item.path === '/cached-retry.png').length, 1, 'DOM retry needs no second HTTP download')
    assert.notEqual(await evaluate(`profileRecovery.account.avatarSnapshot('${pubkey}').displayed && profileRecovery.account.avatarStates$()['${pubkey}'].displayed.token`), await evaluate('avatarDecodeProbe.attempt'))

    await reset()
    await evaluate('avatarDecodeProbe.mode=null')
    await profile('slow.png')
    await browser.until(() => Boolean(releaseSlow), 'slow mobile image request starts')
    await new Promise(resolve => setTimeout(resolve, 21000))
    assert.deepEqual(await stages(), ['fallback', 'fallback', 'fallback'])
    releaseSlow()
    await photos('mobile image completes after the old fifteen-second limit')
    assert.equal(requests.filter(item => item.path === '/slow.png').length, 1, 'the original mobile attempt remains alive')
    assert.equal(await evaluate('avatarDecodeProbe.stages.includes("loading")'), false, 'recovery never reopens the pulse')
    assert.equal(await evaluate('location.pathname'), initialPath)
    assert.equal(await evaluate(`profileRecovery.state.requests.filter(request=>request.pubkey==='${pubkey}').length`), 0, 'own metadata remains local-only')
    console.log('All three home portraits recovered automatically; independent decodes survived one rejection; cached retry made no new HTTP request; mobile request completed after 21 seconds.')
  } catch (error) {
    releaseSlow?.()
    for (const context of browser?.contexts.values() ?? []) {
      if (!/^http:\/\/[0-9]+[.]localhost:10000$/.test(context.origin) || !context.auxData?.isDefault) continue
      console.log('Avatar recovery diagnostic:', await browser.evaluate('({profile:profileRecovery.account.profile$(),avatars:profileRecovery.account.avatarStates$(),decode:avatarDecodeProbe})', context.origin).catch(() => null))
      break
    }
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/avatar-recovery'))
    throw error
  } finally {
    releaseSlow?.()
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
