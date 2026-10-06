import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { finalizeEvent } from 'libp2r2p/event'
import { readFile } from 'node:fs/promises'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('ready home avatars survive persistent eviction and the directory loads only nearby rows', { timeout: 180000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} }); let browser; let permissions; let rejectImages = false; const imageRequests = []
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4VQAAAAASUVORK5CYII=', 'base64')
  const padded = Buffer.alloc(3 * 1024 * 1024); png.copy(padded)
  const imageResponse = { responseCode: 200, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'image/png' }, { name: 'Cache-Control', value: 'no-store' }], body: padded.toString('base64') }
  try {
    let files
    const options = buildOptions({ sourceMaps: false, onEnd: result => { files = result } })
    options.entryPoints[0] = { in: 'tests/browser/fixtures/profile-recovery-entry.js', out: 'app' }
    options.plugins.push({ name: 'avatar-probe', setup (build) { build.onLoad({ filter: /profile-recovery-entry[.]js$/ }, async args => ({ contents: await readFile(args.path, 'utf8') + "\nimport cache from '#services/avatar-cache.js';window.avatarCacheProbe=cache;", loader: 'js', resolveDir: path.dirname(args.path) })) } })
    await esbuild.build(options)
    const html = files.find(file => file.name === 'index.html')
    html.bytes = new TextEncoder().encode(new TextDecoder().decode(html.bytes).replaceAll('z-app', 'z-profile-recovery-fixture'))
    const app = await prepareTestApp(files, { identifier: 'shared-avatars-test', name: 'Shared avatar test' })
    browser = await launchChrome({
      intercept: request => {
        const { hostname } = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(hostname)) return null
        if (['www.gstatic.com', 'connectivitycheck.gstatic.com', 'captive.apple.com', 'connectivity-check.ubuntu.com'].includes(hostname)) return { responseCode: 204, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }], body: '' }
        if (hostname === 'profile-images.example') {
          const pathname = new URL(request.url).pathname
          imageRequests.push({ path: pathname, rejected: rejectImages, cors: Boolean(request.headers.Origin || request.headers.origin) })
          const response = pathname === '/native-photo.png' ? { ...imageResponse, responseHeaders: imageResponse.responseHeaders.filter(header => header.name !== 'Access-Control-Allow-Origin') } : imageResponse
          return rejectImages ? { ...response, responseCode: 503, body: '' } : response
        }
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
    await browser.until(() => evaluate("profileRecovery.account.signerState$()?.isLocked===true && document.querySelector('.toast-card[data-persistent] .toast-message')?.textContent.includes('Unlock your account')"), 'locked startup shows account action')
    assert.equal(await evaluate("Boolean(document.querySelector('.toast-card[data-persistent] .toast-close'))"), false)
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')
    await browser.until(() => evaluate('profileRecovery.account.contactsState$() === "loaded"'), 'initial local contacts')
    await browser.until(() => evaluate("!document.querySelector('.toast-card[data-persistent]')"), 'unlock removes the account warning without a reload')
    const secrets = Array.from({ length: 32 }, () => generateSecretKey()); const peers = secrets.map(getPublicKey); const at = Math.floor(Date.now() / 1000)
    const profiles = secrets.map((secret, index) => finalizeEvent({ kind: 0, created_at: at, tags: [], content: JSON.stringify({ name: `Person ${String(index).padStart(2, '0')}`, picture: `https://profile-images.example/person-${index}.png` }) }, secret))
    await evaluate(`profileRecovery.state.profiles=${JSON.stringify(profiles)}`)
    for (const secret of secrets) { const event = finalizeEvent({ kind: 10002, created_at: at, tags: [['r', 'wss://healthy-profiles.example']], content: '' }, secret); await evaluate(`dmTest.events.set('${event.id}',${JSON.stringify(event)})`) }
    for (const profile of profiles) await evaluate(`window.napp.eventStore.add(${JSON.stringify(profile)})`)
    await evaluate(`window.napp.eventStore.addPersonalCopy({kind:30000,created_at:${at},tags:[['d','+zillion:contacts'],${peers.map(peer => JSON.stringify(['p', peer])).join(',')}],content:''},{context:''})`)
    await browser.until(() => evaluate("document.querySelectorAll('.route-page[data-active=true] .contact-item .avatar-presentation[data-avatar-state=photo]').length>=4"), 'home photos prepared', 45000)
    await evaluate('new Promise(resolve=>setTimeout(resolve,500))')
    const home = await evaluate('Array.from(document.querySelectorAll(\'.route-page[data-active=true] .contact-item\')).filter(item=>item.querySelector(\'.avatar-presentation\')?.dataset.avatarState===\'photo\').map(item=>({id:item.dataset.contactId,name:item.querySelector(\'.contact-name\').textContent,url:profileRecovery.account.personFor(item.dataset.contactId).profile.picture}))')
    // Exercise the production disposable byte cache rather than replacing it.
    // Fill it with unrelated images while live home consumers retain their photos.
    for (let index = 0; index < 9; index++) await evaluate(`avatarCacheProbe.resolveImage('https://profile-images.example/pressure-${index}.png').then(Boolean)`)
    let target; for (const person of home) if (!await evaluate(`avatarCacheProbe.get(${JSON.stringify(person.url)}).then(Boolean)`)) { target = person; break }
    assert.ok(target, 'ready home photo evicted from bounded byte cache')
    const before = imageRequests.length; const metadataBefore = await evaluate('profileRecovery.state.requests.length'); rejectImages = true
    await evaluate("document.querySelector('.route-page[data-active=true] .more').click()")
    const selector = `.route-page[data-active=true] .contact-row[data-person-id="${target.id}"]`
    await browser.until(() => evaluate(`Boolean(document.querySelector('${selector}'))`), 'directory row')
    await browser.until(() => evaluate(`document.querySelector('${selector} .avatar-presentation')?.dataset.avatarState==='photo'`), 'directory reuses ready image with the server unavailable')
    assert.equal(await evaluate(`document.querySelector('${selector} .person-name').textContent`), target.name)
    assert.equal(imageRequests.slice(before).filter(request => request.path === new URL(target.url).pathname).length, 0, 'ready photo performs no HTTP request after persistent eviction')
    assert.equal(await evaluate('profileRecovery.state.requests.length'), metadataBefore, 'directory starts no extra kind-0 lookup')
    assert.ok(await evaluate("document.querySelectorAll('.route-page[data-active=true] .contact-row a-avatar').length<16"), 'offscreen rows have no mounted avatar')
    const last = peers.at(-1)
    const lastSelector = `.route-page[data-active=true] .contact-row[data-person-id="${last}"]`
    assert.equal(await evaluate(`Boolean(document.querySelector('${lastSelector} a-avatar'))`), false)
    rejectImages = false
    await evaluate(`document.querySelector('${lastSelector}').scrollIntoView({block:'center'})`)
    await browser.until(() => evaluate(`document.querySelector('${lastSelector} .avatar-presentation')?.dataset.avatarState==='photo'`), 'scrolling near the row prepares its image')
    const lastRequests = imageRequests.filter(request => request.path === '/person-31.png').length
    await evaluate("document.querySelector('.route-page[data-active=true] .contacts-back').click()")
    await browser.until(() => evaluate("Boolean(document.querySelector('.route-page[data-active=true] .home'))"), 'retained home')
    assert.equal(await evaluate(`document.querySelector('.route-page[data-active=true] .contact-item[data-contact-id="${target.id}"] .avatar-presentation')?.dataset.avatarState`), 'photo')
    await evaluate('testNavigation.forward()')
    await browser.until(() => evaluate(`document.querySelector('${lastSelector} .avatar-presentation')?.dataset.avatarState==='photo'`), 'retained directory photo')
    assert.equal(imageRequests.filter(request => request.path === '/person-31.png').length, lastRequests, 'Back/Forward preserves prepared photo')
    const nativeProfile = finalizeEvent({ kind: 0, created_at: at + 1, tags: [], content: JSON.stringify({ name: 'Person 00', picture: 'https://profile-images.example/native-photo.png' }) }, secrets[0])
    await evaluate(`window.napp.eventStore.add(${JSON.stringify(nativeProfile)})`)
    const nativeRow = `.route-page[data-active=true] .contact-row[data-person-id="${peers[0]}"]`
    await evaluate(`document.querySelector('${nativeRow}').scrollIntoView({block:'center'})`)
    await browser.until(() => evaluate(`document.querySelector('${nativeRow} .avatar-picture')?.getAttribute('src')==='https://profile-images.example/native-photo.png' && document.querySelector('${nativeRow} .avatar-picture').naturalWidth>0`), 'native CORS fallback is loaded')
    assert.equal(await evaluate("avatarCacheProbe.get('https://profile-images.example/native-photo.png').then(Boolean)"), false, 'native URL is not persisted as readable bytes')
    const corsBefore = imageRequests.filter(request => request.path === '/native-photo.png' && request.cors).length
    rejectImages = true
    await evaluate(`(() => {const host=document.createElement('div');host.id='native-avatar-reuse';document.body.append(host);profileRecovery.mountAvatar(host,{pk:'${peers[0]}'})})()`)
    await browser.until(() => evaluate("document.querySelector('#native-avatar-reuse .avatar-presentation')?.dataset.avatarState==='photo' && ((document.querySelector('#native-avatar-reuse .avatar-picture')?.naturalWidth>0) || (document.querySelector('#native-avatar-reuse canvas')?.width>0 && getComputedStyle(document.querySelector('#native-avatar-reuse canvas')).display!=='none'))"), 'native ready photo reuses decoded pixels with the image server unavailable')
    assert.equal(imageRequests.filter(request => request.path === '/native-photo.png' && request.cors).length, corsBefore, 'native reuse skips repeated CORS preparation')
    await evaluate('document.querySelector("#native-avatar-reuse").remove()')
    console.log('Shared avatars: warm photo survives real FIFO eviction, no repeated kind-0/HTTP lookup, offscreen rows mount only when near the viewport')
  } catch (error) { await browser?.diagnose(path.join(root, 'tmp/browser-failures/shared-avatars')); throw error } finally { clearInterval(permissions); await browser?.close(); await runtime.close() }
})
