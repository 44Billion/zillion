import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { npubEncode } from 'libp2r2p/nip19'
import { bytesToBase16 } from 'libp2r2p/base16'

test('signed-out, read-only and recovered accounts have distinct protected notices and avatars', { timeout: 150000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    const app = await prepareTestApp(await compile(), { identifier: 'account-notice-test', name: 'Account notice test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher ready')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 600, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const appUrl = () => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame=>frame.src).find(src=>src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))')
    let url = await browser.until(appUrl, 'app frame')
    const evaluate = expression => browser.evaluate(expression, new URL(url).origin)
    await browser.until(() => evaluate("document.querySelector('.toast-card[data-persistent] .toast-message')?.textContent==='Create or sign in to an account to use Zillion.'"), 'signed-out instruction')
    assert.equal(await evaluate('window.napp.getSignerState().then(state=>state.isDefaultUser)'), true)
    await browser.until(() => evaluate("Boolean(document.querySelector('z-home-header .user-avatar icon-user-circle'))"), 'signed-out user-circle icon')
    assert.equal(await evaluate('document.querySelectorAll(".toast-card[data-persistent]").length'), 1)
    assert.equal(await evaluate("Boolean(document.querySelector('.toast-card[data-persistent] .toast-close'))"), false)
    await evaluate('window.savedAccountNotice=document.querySelector(".toast-card[data-persistent]")')
    await browser.evaluate(`(() => {
      const value=JSON.stringify('pt-BR');localStorage.setItem('config_locale',value);
      window.dispatchEvent(new StorageEvent('storage',{key:'config_locale',newValue:value,storageArea:localStorage}));
    })()`)
    await browser.until(() => evaluate("savedAccountNotice.querySelector('.toast-message').textContent==='Crie ou entre numa conta para usar o Zillion.'"), 'notice translates without replacement')
    assert.equal(await evaluate('document.querySelector(".toast-card[data-persistent]")===savedAccountNotice'), true)
    assert.ok(await evaluate('(() => {const r=savedAccountNotice.getBoundingClientRect();return r.left>=11 && r.right<=innerWidth-11 && r.bottom<=innerHeight-11})()'), 'localized action fits the narrow mobile viewport')
    await evaluate('new Promise(resolve=>setTimeout(resolve,8500))')
    assert.equal(await evaluate('document.querySelector(".toast-card[data-persistent]")===savedAccountNotice'), true, 'notice has no default or extended expiry')

    // Entering a real account creates a new owner document. This is not an
    // in-app signed-out -> signed-in state transition.
    const secret = generateSecretKey()
    const pubkey = getPublicKey(secret)
    const vaultOrigin = 'http://localhost:4000'
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("account-add input"))', vaultOrigin), 'vault account import')
    await browser.evaluate('document.querySelector("create-overlay .create-dismiss")?.click(); document.querySelector("#add-account-btn").click()', vaultOrigin)
    await browser.evaluate(`document.querySelector('account-add input').value=${JSON.stringify(npubEncode(pubkey))}; document.querySelector('account-add form').requestSubmit()`, vaultOrigin)
    await browser.until(() => browser.evaluate(`Boolean(document.querySelector('account-avatar[pubkey="${pubkey}"]'))`, vaultOrigin), 'read-only test account imported')
    url = await browser.until(async () => {
      const next = await appUrl()
      return next && next !== url ? next : null
    }, 'new account app document')
    await browser.until(() => evaluate("document.querySelector('.toast-card[data-persistent] .toast-message')?.textContent==='Importe a chave privada desta conta no cofre de credenciais para acessar contatos e conversas.'"), 'read-only instruction without bunker URL')
    assert.equal(await evaluate('window.napp.getSignerState().then(state=>state.isDefaultUser)'), false)
    assert.equal(await evaluate('Boolean(document.querySelector("z-home-header .user-avatar icon-user-circle"))'), false)
    const currentUrl = url
    await evaluate('window.savedReadOnlyNotice=document.querySelector(".toast-card[data-persistent]")')
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    const vaultContext = [...browser.contexts.values()].find(context => context.origin === vaultOrigin && context.auxData?.isDefault)
    await browser.send('WebAuthn.enable', { enableUI: false }, vaultContext.sessionId)
    await browser.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2', ctap2Version: 'ctap2_1', transport: 'internal',
        hasResidentKey: true, hasUserVerification: true, hasPrf: true,
        isUserVerified: true, automaticPresenceSimulation: true
      }
    }, vaultContext.sessionId)
    await browser.evaluate('document.querySelector("#add-account-btn").click()', vaultOrigin)
    await browser.evaluate(`document.querySelector('account-add input').value=${JSON.stringify(bytesToBase16(secret))}; document.querySelector('account-add form').requestSubmit()`, vaultOrigin)
    await browser.until(async () => {
      await browser.evaluate('document.querySelector("passkey-fallback-dialog [data-choice=local]")?.click()', vaultOrigin)
      return evaluate('window.napp.getSignerState().then(state=>state.supportsContentKeyMethods===true && state.isReadOnly===false && state.isLocked===false)')
    }, 'same account upgraded to nsec', 45000)
    await browser.until(() => evaluate('!document.querySelector(".toast-card[data-persistent]")'), 'account notice cleared after recovery')
    assert.equal(await appUrl(), currentUrl, 'same-identity capability recovery keeps the app document')
    assert.equal(await evaluate('typeof window.nostr.doubleSignEvent'), 'function')
    permissions = setInterval(() => browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {}), 100)
    const result = await evaluate(`window.napp.eventStore.addPersonalCopy({kind:9,created_at:Math.floor(Date.now()/1000),tags:[],content:'Recovered account'}, {context:${JSON.stringify('dm:' + pubkey)}})`)
    assert.equal(result.result.ok, true, 'recovered account can write with real content-key signing')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/account-notice'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
