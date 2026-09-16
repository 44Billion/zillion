import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compile } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

// Exercise the actual root task and its real two-minute timer, without an
// account, a chat route, file selection or a shortened production deadline.
test('launcher app cleans abandoned OPFS after two minutes without sending files', { timeout: 240000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  try {
    const app = await prepareTestApp(await compile(), { identifier: 'maintenance-test', name: 'Maintenance test' })
    browser = await launchChrome()
    await browser.navigate('http://localhost:10000')
    await browser.until(() => browser.evaluate('Boolean(localStorage.getItem("session_workspaceKeys"))'), 'launcher initialization')
    await browser.evaluate(app.installExpression); app.installExpression = null
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const url = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app iframe')
    const origin = new URL(url).origin
    const evaluate = script => browser.evaluate(script, origin)
    await browser.until(() => evaluate('!!document.querySelector("z-router")'), 'root mounted without account')
    assert.ok(await evaluate('performance.now() < 60000'), 'fixture ready before initial deadline')
    await evaluate(`(async () => {
      const root = await navigator.storage.getDirectory();
      const dir = await root.getDirectoryHandle('zillion-compression-v1', {create:true});
      window.maintenanceNames = () => Array.fromAsync(dir.keys());
      await new Promise(resolve => navigator.locks.request('zillion-compression-v1:artifact-bbbb', () => new Promise(release => {window.releaseMaintenanceOwner=release; resolve();})));
      for (const name of ['artifact-aaaa','artifact-aaaa.crswap','artifact-bbbb','keep-me']) await dir.getFileHandle(name,{create:true});
    })()`)
    await browser.until(() => evaluate('performance.now() >= 119000'), 'real initial grace period', 125000)
    assert.deepEqual((await evaluate('maintenanceNames()')).sort(), ['artifact-aaaa', 'artifact-aaaa.crswap', 'artifact-bbbb', 'keep-me'])
    console.log('Maintenance: original two-minute delay respected, no file selected')
    await browser.until(() => evaluate('maintenanceNames().then(names => !names.includes("artifact-aaaa"))'), 'root maintenance removes abandoned files', 45000)
    assert.deepEqual((await evaluate('maintenanceNames()')).sort(), ['artifact-bbbb', 'keep-me'])
    await evaluate('releaseMaintenanceOwner()')
    console.log('Maintenance: real OPFS cleaned; active owner and unknown file preserved')
  } finally { await browser?.close(); await runtime.close() }
})
