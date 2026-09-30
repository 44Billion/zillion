import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { buildOptions, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'

test('cold home previews and ordering load independently of self and contact histories', { timeout: 120000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  try {
    let files
    const options = buildOptions({ onEnd: result => { files = result } })
    options.sourcemap = false
    options.plugins.push({
      name: 'home-summaries-test', setup (build) {
        build.onLoad({ filter: /src\/components\/app\.js$/ }, async args => ({
          contents: await readFile(args.path, 'utf8') + '\nimport "../../tests/browser/fixtures/home-summaries-driver.js"',
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
        build.onLoad({ filter: /src\/components\/hooks\/use-account\.js$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8'))
            .replace("from '#services/contacts.js'", "from '../../../tests/browser/fixtures/contact-readiness.js'")
            .replace("from '#services/private-chats.js'", "from '../../../tests/browser/fixtures/contact-readiness.js'")
            .replaceAll('window.napp.eventStore', 'window.contactBoot.observeStore(window.napp.eventStore)'),
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'home-summaries-test', name: 'Home summaries test' })
    browser = await launchChrome({
      intercept: request => /^(?:[a-z0-9-]+\.)*localhost$/.test(new URL(request.url).hostname) ? null : false
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
    await browser.until(() => evaluate('contactBoot.account.contactsState$() === "loaded"'), 'initial local contacts')
    const peer = getPublicKey(generateSecretKey())
    const other = getPublicKey(generateSecretKey())
    const empty = getPublicKey(generateSecretKey())
    for (const contact of [peer, other, empty]) await evaluate(`contactBoot.account.setContact('${contact}', true)`)
    const base = Math.floor(Date.now() / 1000) - 1000
    for (const contact of [pubkey, peer, other]) {
      await evaluate(`(async () => { for (let index = 0; index < 12; index++) await contactBoot.seedMessage({ peer: '${contact}', at: ${base} + index, text: 'Older message ' + index }) })()`)
    }
    const selfLatest = await evaluate(`contactBoot.seedMessage({ peer: '${pubkey}', at: ${base + 100}, filename: 'self-notes.pdf' })`)
    const peerLatest = await evaluate(`contactBoot.seedMessage({ peer: '${peer}', at: ${base + 200}, text: 'Latest contact text' })`)
    const newest = await evaluate(`contactBoot.seedMessage({ peer: '${other}', at: ${base + 300}, filename: 'trip.pdf', caption: 'Trip caption' })`)
    await browser.evaluate(`(() => {
      const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)});
      const url = new URL(frame.src); url.pathname = '/'; url.search = '?holdOutbox=1'; frame.src = url.href;
    })()`)
    await browser.until(() => evaluate(`['${pubkey}', '${peer}', '${other}', '${empty}'].every(peer => contactBoot.account.summaries$()[peer]?.state === 'loaded')`), 'cold local summaries ready before visiting any conversation')
    const rows = () => evaluate('[...document.querySelectorAll(\'.route-page[data-active=true] .conversation button\')].map(button => ({ id: button.dataset.contactId, preview: button.querySelector(\'.preview\').textContent }))')
    const expectedRows = [
      { id: other, preview: 'Trip caption' },
      { id: peer, preview: 'Latest contact text' },
      { id: 'user', preview: 'self-notes.pdf' }
    ]
    await browser.until(async () => JSON.stringify(await rows()) === JSON.stringify(expectedRows), 'summary state is rendered in all home rows')
    assert.deepEqual(await rows(), expectedRows)
    assert.equal(await evaluate('contactBoot.queueFinished'), false)
    assert.equal(await evaluate('contactBoot.account.historyLoaded$()'), false, 'self history stays lazy')
    assert.equal(await evaluate('contactBoot.account.messages$().length'), 0)
    assert.deepEqual(await evaluate('Object.keys(contactBoot.account.conversations$())'), [])
    const reads = await evaluate('contactBoot.reads')
    const snapshots = reads.filter(read => read.method === 'subscribe' && read.options?.initial && read.filter['#k']?.includes('9'))
    assert.equal(snapshots.length, 4)
    assert.ok(snapshots.every(read => read.filter.limit === 1), 'home must not open 50-message histories')
    assert.ok(!reads.some(read => read.filter.kinds?.includes(34601)), 'file previews only read metadata')
    assert.deepEqual(await evaluate('contactBoot.mediaStates'), [], 'home never starts thumbnail/original transfers')
    const incoming = await evaluate(`contactBoot.seedMessage({ peer: '${peer}', at: ${base + 400}, filename: 'fresh.pdf' })`)
    await browser.until(async () => (await rows())[0]?.preview === 'fresh.pdf', 'new local message reorders unopened contact')
    await evaluate(`napp.eventStore.addPersonalCopy({kind:5,created_at:Math.floor(Date.now()/1000),tags:[['e','${incoming}'],['k','9']],content:''},{context:'dm:${peer}'})`)
    await browser.until(async () => { const list = await rows(); return list[0]?.id === other && list[1]?.preview === 'Latest contact text' }, 'deleting latest message restores ordering and preview without opening chat')
    assert.equal((await rows())[1].preview, 'Latest contact text')
    await evaluate(`napp.eventStore.addPersonalCopy({kind:5,created_at:Math.floor(Date.now()/1000),tags:[['e','${newest}'],['k','9']],content:''},{context:'dm:${other}'})`)
    await browser.until(async () => { const list = await rows(); return list[0]?.id === peer && list[2]?.preview === 'Older message 11' }, 'another deletion falls back to older local history')
    const beforeVisit = await rows()
    for (const [contact, key, id, text] of [['user', pubkey, selfLatest, 'self-notes'], [peer, peer, peerLatest, 'Latest contact text']]) {
      await evaluate('contactBoot.holdHistory()')
      await evaluate(`document.querySelector('.route-page[data-active=true] .conversation button[data-contact-id="${contact}"]').click()`)
      const loaded = contact === 'user' ? 'contactBoot.account.historyLoaded$()' : `!!contactBoot.account.conversations$()['${key}']?.historyLoaded`
      await browser.until(() => evaluate(`document.querySelector('.route-page[data-active=true] [data-message-id="${id}"] .chat-bubble')?.textContent.includes('${text}')`), 'latest bubble and its content are immediately available while history delivery is held')
      assert.equal(await evaluate(loaded), false)
      assert.equal(await evaluate('document.querySelectorAll(\'.route-page[data-active=true] [data-message-id]\').length'), 1)
      assert.ok(await evaluate(`document.querySelector('.route-page[data-active=true] [data-message-id="${id}"]').textContent.includes('${text}')`), 'text or filename is already expanded')
      assert.ok(await evaluate('document.querySelector(\'.route-page[data-active=true] .chat-date[role=status]\').textContent.includes(\'Loading conversation\')'))
      await evaluate(`contactBoot.lastBubble = document.querySelector('.route-page[data-active=true] [data-message-id="${id}"] .chat-bubble')`)
      await evaluate('contactBoot.releaseHistory()')
      await browser.until(() => evaluate(loaded), 'history starts only on visiting the conversation')
      await browser.until(() => evaluate('document.querySelectorAll(\'.route-page[data-active=true] [data-message-id]\').length === 13'), 'earlier messages join the existing latest bubble')
      assert.equal(await evaluate(`document.querySelector('.route-page[data-active=true] [data-message-id="${id}"] .chat-bubble') === contactBoot.lastBubble`), true, 'the latest bubble keeps its DOM node through history loading')
      assert.equal(await evaluate(`document.querySelectorAll('.route-page[data-active=true] [data-message-id="${id}"]').length`), 1)
      await evaluate('document.querySelector(".route-page[data-active=true] .chat-back").click()')
      await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .conversations")'), 'return to chat list')
      assert.deepEqual(await rows(), beforeVisit, 'visiting a conversation does not repair or change its preview/order')
    }
    console.log('Cold previews, metadata-only reads, ordering, live updates, deletions, immediate cached bubbles and lazy histories verified')
    await evaluate('contactBoot.releaseQueue()')
  } catch (error) {
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/home-summaries'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
