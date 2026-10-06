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

test('shared profiles recover and avatars pulse only before their first presentation', { timeout: 180000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  const imageWaiters = new Map()
  const imageRequests = []
  const blockedImages = new Set(['initial-photo.png', 'new-photo.png', 'late-photo.png', 'budget-photo.png', 'obsolete-photo.png'])
  const imageResponse = { responseCode: 200, responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'image/png' }], body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4VQAAAAASUVORK5CYII=' }
  const responseForImage = name => {
    if (!['new-photo.png', 'late-photo.png'].includes(name)) return imageResponse
    const size = name === 'new-photo.png' ? 2 : 3
    return {
      ...imageResponse,
      responseHeaders: [{ name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Content-Type', value: 'image/svg+xml' }],
      body: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="red"/></svg>`).toString('base64')
    }
  }
  const releaseImage = name => {
    blockedImages.delete(name)
    for (const reply of imageWaiters.get(name) ?? []) reply(responseForImage(name))
    imageWaiters.delete(name)
  }
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
        if (hostname === 'profile-images.example') {
          const name = new URL(request.url).pathname.slice(1)
          imageRequests.push(name)
          if (name === 'broken.png') return { ...imageResponse, body: Buffer.from('invalid image bytes').toString('base64') }
          if (blockedImages.has(name)) {
            return new Promise(resolve => {
              imageWaiters.set(name, [...(imageWaiters.get(name) ?? []), resolve])
            })
          }
          return responseForImage(name)
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
    const secrets = [generateSecretKey(), generateSecretKey(), generateSecretKey(), generateSecretKey()]
    const peers = secrets.map(getPublicKey)
    const profiles = secrets.map((secret, index) => finalizeEvent({
      kind: 0, created_at: Math.floor(Date.now() / 1000), tags: [],
      content: JSON.stringify({ name: ['Aaron', 'Mona', 'Pinned', 'Zoe'][index], picture: 'https://profile-images.example/avatar.png' })
    }, secret))
    await evaluate(`profileRecovery.state.peer = '${peers[0]}'; profileRecovery.state.profiles = ${JSON.stringify(profiles)}; profileRecovery.state.releaseAt = Date.now() + 12000; profileRecovery.state.holdPeers=['${peers[3]}']`)
    for (const secret of secrets.slice(1)) {
      const list = finalizeEvent({ kind: 10002, created_at: profiles[0].created_at, tags: [['r', 'wss://healthy-profiles.example']], content: '' }, secret)
      await evaluate(`dmTest.events.set('${list.id}', ${JSON.stringify(list)})`)
    }
    for (const profile of profiles.slice(1, 3)) await evaluate(`window.napp.eventStore.add(${JSON.stringify(profile)})`)
    await evaluate(`window.napp.eventStore.addPersonalCopy({kind:30000,created_at:${profiles[0].created_at},tags:[['d','+zillion:contacts'],['p','${peers[0]}'],['p','${peers[1]}'],['p','${peers[2]}','','','p'],['p','${peers[3]}']],content:''},{context:''})`)
    const selector = `.contact-item[data-contact-id="${peers[0]}"]`
    await browser.until(() => evaluate(`document.querySelector('${selector} .contact-name')?.textContent.startsWith('npub1')`), 'missing profile fallback')
    await browser.until(() => evaluate(`profileRecovery.state.held.length>0 && profileRecovery.account.directory$()['${peers[1]}']?.name==='Mona'`), 'partial names with a pending first lookup')
    const arrivalOrder = await evaluate('Array.from(document.querySelectorAll(\'.route-page[data-active=true] .contact-item\')).map(item => item.dataset.contactId)')
    assert.equal(arrivalOrder[0], peers[2], 'pins are first even during startup')
    assert.ok(arrivalOrder.indexOf(peers[0]) < arrivalOrder.indexOf(peers[1]), 'cached names do not move avatars before the remaining first lookup settles')
    assert.equal(await evaluate('profileRecovery.account.contactOrder$().alphabetical'), false)
    const heldAvatar = `.contact-item[data-contact-id="${peers[3]}"] .avatar-presentation`
    await browser.until(() => evaluate(`document.querySelector('${heldAvatar}')?.dataset.avatarState === 'loading'`), 'local-only contact waits for shared first lookup')
    await evaluate('profileRecovery.state.holdPeers=[];profileRecovery.state.held.splice(0).forEach(reply=>reply())')
    await browser.until(() => evaluate('profileRecovery.account.contactOrder$().alphabetical'), 'failed first lookup releases the initial cohort')
    const before = await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${peers[0]}').length`)
    assert.ok(before > 0)
    // Mount two independent remote-capable avatars for the same pending peer.
    // They must share the contact lookup and its existing cooldown.
    await evaluate(`(() => {
      const host = document.createElement('div'); host.id = 'duplicate-avatars';
      document.body.append(host); profileRecovery.mountAvatars(host, '${peers[0]}');
    })()`)
    await browser.until(() => evaluate(`profileRecovery.account.directory$()['${peers[1]}']?.name === 'Mona'`), 'other profiles remain available')
    await browser.until(() => evaluate(`(() => {
      const ids=Array.from(document.querySelectorAll('.route-page[data-active=true] .contact-item')).map(item=>item.dataset.contactId);
      return ids.indexOf('${peers[0]}') > ids.indexOf('${peers[1]}');
    })()`), 'alphabetical DOM update after initial readiness')
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
    await browser.until(() => evaluate(`document.querySelector('${selector} .avatar-presentation')?.dataset.avatarState === 'photo' && document.querySelector('${selector} .avatar-picture')?.naturalWidth > 0`), 'recovered avatar bytes')
    const cached = await evaluate(`window.napp.eventStore.query({ kinds: [0], authors: ['${peers[0]}'] })`)
    assert.equal(cached.results[0].id, profiles[0].id)
    const count = attempts.length
    await evaluate('document.querySelector("#duplicate-avatars").remove()')
    await evaluate(`profileRecovery.account.loadPerson('${peers[0]}')`)
    assert.equal(await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${peers[0]}').length`), count)
    const allCached = await evaluate(`window.napp.eventStore.query({kinds:[0],authors:${JSON.stringify(peers)}})`)
    assert.deepEqual(new Set(allCached.results.map(event => event.id)), new Set(profiles.map(event => event.id)), 'cache contains original public signed kind-0 events')

    // Exercise the real component and event-store stream with delayed HTTP bytes.
    let ownTimestamp = profiles[0].created_at + 1
    const ownProfile = picture => finalizeEvent({ kind: 0, created_at: ownTimestamp++, tags: [], content: JSON.stringify(picture ? { picture } : {}) }, secret)
    const imageUrl = name => `https://profile-images.example/${name}`
    await evaluate(`window.napp.eventStore.add(${JSON.stringify(ownProfile(imageUrl('initial-photo.png')))})`)
    await evaluate(`(() => {
      const host = document.createElement('div'); host.id = 'avatar-lifecycle'; document.body.append(host);
      profileRecovery.mountAvatar(host, {pk:'${pubkey}'});
      window.avatarStates=[];
      window.avatarObserver=new MutationObserver(() => {
        const value=host.querySelector('.avatar-presentation')?.dataset.avatarState;
        if(value) avatarStates.push(value);
      });
      avatarObserver.observe(host,{subtree:true,attributes:true,childList:true});
    })()`)
    const stage = "document.querySelector('#avatar-lifecycle .avatar-presentation')?.dataset.avatarState"
    const source = "document.querySelector('#avatar-lifecycle .avatar-picture')?.getAttribute('src')"
    await browser.until(() => evaluate(`${stage} === 'fallback'`), 'own avatar reuses its initial fallback without another pulse')
    await browser.until(() => imageWaiters.has('initial-photo.png'), 'initial image fetch')
    releaseImage('initial-photo.png')
    await browser.until(() => evaluate(`${stage} === 'photo'`), 'shared fallback to decoded own photo')
    const firstSource = await evaluate(source)
    await evaluate('avatarStates.length=0')
    await evaluate(`window.napp.eventStore.add(${JSON.stringify(ownProfile(imageUrl('new-photo.png')))})`)
    await browser.until(() => imageWaiters.has('new-photo.png'), 'replacement fetch')
    assert.equal(await evaluate(stage), 'photo')
    assert.equal(await evaluate(source), firstSource, 'old photo stays visible while replacement prepares')
    releaseImage('new-photo.png')
    await browser.until(() => evaluate(`profileRecovery.account.profile$()?.picture.endsWith('/new-photo.png') && ${stage} === 'photo'`), 'new own metadata')
    await browser.until(() => evaluate("document.querySelector('#avatar-lifecycle .avatar-picture')?.naturalWidth === 2"), 'replacement decoded and presented')
    const secondSource = await evaluate(source)
    assert.notEqual(secondSource, firstSource)
    await evaluate(`window.napp.eventStore.add(${JSON.stringify(ownProfile(imageUrl('broken.png')))})`)
    await browser.until(() => imageRequests.includes('broken.png'), 'broken candidate requested')
    await browser.until(() => evaluate("profileRecovery.account.profile$()?.picture.endsWith('/broken.png')"), 'broken candidate metadata')
    assert.equal(await evaluate(stage), 'photo', 'failed replacement retains a photo')
    assert.equal(await evaluate(source), secondSource)
    await evaluate(`window.napp.eventStore.add(${JSON.stringify(ownProfile(null))})`)
    await browser.until(() => evaluate(`${stage} === 'fallback'`), 'explicit photo removal')
    await evaluate(`window.napp.eventStore.add(${JSON.stringify(ownProfile(imageUrl('late-photo.png')))})`)
    await browser.until(() => imageWaiters.has('late-photo.png'), 'late photo fetch')
    assert.equal(await evaluate(stage), 'fallback', 'fallback remains while the late image loads')
    releaseImage('late-photo.png')
    await browser.until(() => evaluate(`${stage} === 'photo'`), 'fallback to photo without another pulse')
    assert.equal(await evaluate("avatarStates.includes('loading')"), false, 'profile updates never reopen the pulse')
    assert.equal(await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${pubkey}').length`), 0, 'own avatars never fetch relay profiles')
    const cachedImageRequests = imageRequests.length
    await evaluate(`profileRecovery.mountAvatar(document.querySelector('#avatar-lifecycle'), {pk:'${pubkey}'})`)
    await browser.until(() => evaluate(`${stage} === 'photo'`), 'cached photo is ready without an artificial minimum delay')
    assert.equal(imageRequests.length, cachedImageRequests, 'cached photo requires no HTTP download')

    const budgetPeer = getPublicKey(generateSecretKey())
    await evaluate(`profileRecovery.mountAvatar(document.querySelector('#avatar-lifecycle'), {pk:'${budgetPeer}',profile:{picture:'${imageUrl('budget-photo.png')}'}})`)
    await browser.until(() => evaluate(`${stage} === 'loading'`), 'initial image budget starts')
    await browser.until(() => imageWaiters.has('budget-photo.png'), 'budget image request')
    await browser.until(() => evaluate(`${stage} === 'fallback'`), 'ten-second visual budget expires', 15000)
    await evaluate('avatarStates.length=0')
    releaseImage('budget-photo.png')
    await browser.until(() => evaluate(`${stage} === 'photo'`), 'late image completes after the visual deadline')
    assert.equal(await evaluate("avatarStates.includes('loading')"), false)
    assert.equal(await evaluate(`profileRecovery.state.requests.filter(request => request.pubkey === '${budgetPeer}').length`), 0, 'local-only avatar initiates no relay query')
    await evaluate(`profileRecovery.mountAvatar(document.querySelector('#avatar-lifecycle'), {pk:'${budgetPeer}',profile:{picture:'${imageUrl('obsolete-photo.png')}'}})`)
    await browser.until(() => imageWaiters.has('obsolete-photo.png'), 'obsolete image request')
    await evaluate(`profileRecovery.avatar.pk$('${pubkey}'); profileRecovery.avatar.profile$({})`)
    await browser.until(() => evaluate(`${stage} === 'photo' && document.querySelector('#avatar-lifecycle .avatar-picture')?.naturalWidth === 3`), 'new identity uses its own cached photo')
    const identitySource = await evaluate(source)
    releaseImage('obsolete-photo.png')
    assert.equal(await evaluate(source), identitySource, 'old identity cannot replace the new photo')
    await evaluate('avatarObserver.disconnect(); document.querySelector("#avatar-lifecycle").remove()')
    let appContext
    for (const context of [...browser.contexts.values()].filter(context => context.origin === origin && context.auxData?.isDefault)) {
      const result = await browser.send('Runtime.evaluate', { expression: 'Boolean(window.profileRecovery)', contextId: context.id, returnByValue: true }, context.sessionId)
      if (result.result.value) { appContext = context; break }
    }
    assert.ok(appContext)
    await browser.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__profileRecoveryHoldAll=true' }, appContext.sessionId)
    // Reload through the parent's iframe URL, retaining the trusted bridge marker.
    await browser.evaluate(`(() => {const frame=[...document.querySelectorAll('app-window iframe')].find(frame=>frame.src.startsWith('${origin}'));frame.setAttribute('src',frame.src)})()`)
    await browser.until(() => evaluate(`globalThis.__profileRecoveryHoldAll && window.profileRecovery?.account.contactOrder$().alphabetical && profileRecovery.account.directory$()['${peers[0]}']?.name==='Aaron'`), 'cached startup sorts without remote completion', 30000)
    await browser.until(() => evaluate('profileRecovery.state.held.length>0'), 'cached remote refresh still pending')
    await evaluate('testNavigation.pushState(null,"","/contacts")')
    await evaluate('testNavigation.pushState(null,"","/")')
    assert.equal(await evaluate('profileRecovery.account.contactOrder$().alphabetical'), true, 'route navigation does not restart the gate')

    // Self pin is a real private-list preference, separate from peer membership.
    const ownPinButton = '.route-page[data-active=true] .profile-screen[data-profile-id=user] .pin-toggle'
    const ownItem = '.route-page[data-active=true] .contact-item[data-contact-id=user]'
    await evaluate('testNavigation.pushState({fromHome:true},"","/profile/user")')
    await browser.until(() => evaluate(`Boolean(document.querySelector('${ownPinButton}'))`), 'own profile pin control')
    await evaluate(`document.querySelector('${ownPinButton}').click()`)
    await browser.until(() => evaluate(`profileRecovery.account.selfPinned$() && document.querySelector('${ownPinButton}')?.getAttribute('aria-pressed')==='true'`), 'self pin committed')
    const pinnedOverride = await evaluate('profileRecovery.readContactsOverride()')
    assert.deepEqual(pinnedOverride.tags.find(tag => tag[0] === 'p' && tag[1] === pubkey).slice(0, 5), ['p', pubkey, '', '', 'p'])
    assert.equal(await evaluate(`profileRecovery.account.contacts$().some(contact=>contact.pubkey==='${pubkey}')`), false, 'self never becomes an external contact')
    await evaluate('testNavigation.back()')
    await browser.until(() => evaluate(`Boolean(document.querySelector('${ownItem} .contact-pin'))`), 'home shows persisted self pin')
    assert.equal(await evaluate(`document.querySelectorAll('${ownItem}').length`), 1, 'self is rendered once')
    assert.equal(await evaluate("document.querySelector('.route-page[data-active=true] .contact-list').scrollLeft"), 0, 'self pin remains visible without manual scrolling')
    await browser.evaluate(`(() => {const frame=[...document.querySelectorAll('app-window iframe')].find(frame=>frame.src.startsWith('${origin}'));frame.setAttribute('src',frame.src)})()`)
    await browser.until(() => evaluate(`window.profileRecovery?.account.contactsState$()==='loaded' && profileRecovery.account.selfPinned$() && document.querySelector('${ownItem} .contact-pin')`), 'self pin survives iframe reload')
    await evaluate('testNavigation.pushState({fromHome:true},"","/profile/user")')
    await browser.until(() => evaluate(`document.querySelector('${ownPinButton}')?.getAttribute('aria-pressed')==='true'`), 'profile reads persisted self pin')
    await evaluate(`document.querySelector('${ownPinButton}').click()`)
    await browser.until(() => evaluate(`!profileRecovery.account.selfPinned$() && document.querySelector('${ownPinButton}')?.getAttribute('aria-pressed')==='false'`), 'self unpin committed')
    const unpinnedOverride = await evaluate('profileRecovery.readContactsOverride()')
    assert.equal(unpinnedOverride.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey), false, 'unpin removes the self entry entirely')
    assert.equal(unpinnedOverride.tags.find(tag => tag[0] === 'p' && tag[1] === peers[2])[4], 'p', 'other pins are preserved')
    await evaluate('testNavigation.pushState({},"","/chat/user")')
    await browser.until(() => evaluate("Boolean(document.querySelector('.route-page[data-active=true] .chat-composer'))"), 'self chat remains available after unpin')
    assert.equal(await evaluate("Boolean(document.querySelector('.route-page[data-active=true] .contact-invitation'))"), false)
    await evaluate('testNavigation.replaceState({},"","/")')
    await browser.until(() => evaluate(`document.querySelector('${ownItem}') && !document.querySelector('${ownItem} .contact-pin')`), 'self remains in home without a pin')
    await browser.evaluate(`(() => {const frame=[...document.querySelectorAll('app-window iframe')].find(frame=>frame.src.startsWith('${origin}'));frame.setAttribute('src',frame.src)})()`)
    await browser.until(() => evaluate(`window.profileRecovery?.account.contactsState$()==='loaded' && !profileRecovery.account.selfPinned$() && document.querySelector('${ownItem}')`), 'self unpin survives iframe reload')
    const finalOverride = await evaluate('profileRecovery.readContactsOverride()')
    assert.equal(finalOverride.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey), false)
  } catch (error) {
    for (const context of browser?.contexts.values() ?? []) {
      if (/^http:\/\/[0-9]+[.]localhost:10000$/.test(context.origin) && context.auxData?.isDefault) {
        console.log('Profile recovery diagnostic:', await browser.evaluate('({ contacts:profileRecovery.account.contactsState$(), signer:profileRecovery.account.signerState$(), error:profileRecovery.account.error$(), ready:profileRecovery.account.ready$(), avatars:Object.keys(profileRecovery.account.avatarStates$()).length })', context.origin).catch(() => null))
      }
    }
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/profile-recovery'))
    throw error
  } finally {
    for (const name of [...imageWaiters.keys()]) releaseImage(name)
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
