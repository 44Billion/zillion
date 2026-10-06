import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('read-only startup has one protected account action that follows the launcher locale', { timeout: 90000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const app = await prepareTestApp(await compile(), { identifier: 'account-notice-test', name: 'Account notice test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher ready')
    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 600, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const url = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame=>frame.src).find(src=>src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app frame')
    const evaluate = expression => browser.evaluate(expression, new URL(url).origin)
    await browser.until(() => evaluate("document.querySelector('.toast-card[data-persistent] .toast-message')?.textContent==='Import the private key or bunker URL for this account into the credential vault.'"), 'read-only account instruction')
    assert.equal(await evaluate('document.querySelectorAll(".toast-card[data-persistent]").length'), 1)
    assert.equal(await evaluate("Boolean(document.querySelector('.toast-card[data-persistent] .toast-close'))"), false)
    await evaluate('window.savedAccountNotice=document.querySelector(".toast-card[data-persistent]")')
    await browser.evaluate(`(() => {
      const value=JSON.stringify('pt-BR');localStorage.setItem('config_locale',value);
      window.dispatchEvent(new StorageEvent('storage',{key:'config_locale',newValue:value,storageArea:localStorage}));
    })()`)
    await browser.until(() => evaluate("savedAccountNotice.querySelector('.toast-message').textContent==='Importe a chave privada ou URL de bunker desta conta no cofre de credenciais.'"), 'notice translates without replacement')
    assert.equal(await evaluate('document.querySelector(".toast-card[data-persistent]")===savedAccountNotice'), true)
    assert.ok(await evaluate('(() => {const r=savedAccountNotice.getBoundingClientRect();return r.left>=11 && r.right<=innerWidth-11 && r.bottom<=innerHeight-11})()'), 'localized action fits the narrow mobile viewport')
    await evaluate('new Promise(resolve=>setTimeout(resolve,8500))')
    assert.equal(await evaluate('document.querySelector(".toast-card[data-persistent]")===savedAccountNotice'), true, 'notice has no default or extended expiry')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/account-notice'))
    throw error
  } finally {
    await browser?.close()
    await runtime.close()
  }
})
