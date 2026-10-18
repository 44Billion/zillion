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

test('cold and cached summaries order chats and prefetch independently of pending summaries', { timeout: 240000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  const summaryErrors = []
  try {
    let files
    const options = buildOptions({ sourceMaps: false, onEnd: result => { files = result } })
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
        build.onLoad({ filter: /src\/services\/conversation-summaries\.js$/ }, async args => ({
          contents: (await readFile(args.path, 'utf8')).replace("from './conversation-summary-cache.js'", "from '../../tests/browser/fixtures/home-cache-probe.js'"),
          loader: 'js', resolveDir: path.dirname(args.path)
        }))
      }
    })
    await esbuild.build(options)
    const app = await prepareTestApp(files, { identifier: 'home-summaries-test', name: 'Home summaries test' })
    browser = await launchChrome({
      onEvent: ({ method, params }) => {
        if (method !== 'Runtime.consoleAPICalled') return
        const values = params.args.map(value => value.value ?? value.description)
        if (values.some(value => typeof value === 'string' && value.includes('Could not load conversation preview'))) summaryErrors.push(values)
      },
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
    await browser.evaluate('document.querySelector("vault-lock-button:not([hidden])")?.click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'test account starts locked')

    const session = [...browser.contexts.values()].find(context => context.origin === 'http://localhost:10000' && context.auxData?.isDefault).sessionId
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 780, deviceScaleFactor: 1, mobile: true }, session)
    await browser.evaluate(app.installExpression)
    await browser.navigate(`http://localhost:10000/${app.app}`)
    const url = await browser.until(() => browser.evaluate('[...document.querySelectorAll("app-window iframe")].map(frame => frame.src).find(src => src.startsWith("http:") && /^[0-9]+[.]localhost$/.test(new URL(src).hostname))'), 'app frame')
    const origin = new URL(url).origin
    const evaluate = expression => browser.evaluate(expression, origin)
    const collect = async () => {
      for (const context of browser.contexts.values()) if (context.auxData?.isDefault) await browser.send('HeapProfiler.collectGarbage', {}, context.sessionId)
    }
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')
    await browser.until(() => evaluate('contactBoot.account.contactsState$() === "loaded"'), 'initial local contacts')
    // Opening the vault can dismiss pending setup permissions. Recover through
    // the real account coordinator after that UI transition, before seeding.
    await browser.until(() => evaluate(`['loaded','unavailable'].includes(contactBoot.account.summaries$()['${pubkey}']?.state)`), 'initial summary setup settles')
    if (await evaluate(`contactBoot.account.summaries$()['${pubkey}']?.state==='unavailable'`)) await evaluate('contactBoot.account.recovery$(value=>value+1)')
    await browser.until(() => evaluate(`contactBoot.account.summaries$()['${pubkey}']?.state==='loaded'`), 'initial self summary permission settles before navigation')
    // Seed source history away from home so ordinary visible prefetch does not
    // compete with fixture creation. Both tested home openings follow below.
    await browser.until(() => evaluate('Boolean(document.querySelector(".contact-strip .add-contact"))'), 'home add-contact control')
    await evaluate('document.querySelector(".contact-strip .add-contact").click()')
    await browser.until(() => evaluate('!document.querySelector(".route-page[data-active=true] .home")'), 'home is inactive during fixture preparation')
    const peer = getPublicKey(generateSecretKey())
    const other = getPublicKey(generateSecretKey())
    const empty = getPublicKey(generateSecretKey())
    console.log('Seeding local contacts and history')
    for (const contact of [peer, other, empty]) await evaluate(`contactBoot.account.setContact('${contact}', true)`)
    const base = Math.floor(Date.now() / 1000) - 1000
    for (const contact of [pubkey, peer, other]) {
      for (let index = 0; index < (contact === peer ? 4 : 1); index++) await evaluate(`contactBoot.seedMessage({ peer: '${contact}', at: ${base + index}, text: 'Older message ${index}' })`)
    }
    console.log('Seeding reference metadata')
    const olderFile = await evaluate(`contactBoot.seedMessage({ peer: '${peer}', at: ${base + 70}, filename: 'older-attachment.pdf' })`)
    const selfLatest = await evaluate(`contactBoot.seedMessage({ peer: '${pubkey}', at: ${base + 100}, filename: 'self-notes.pdf' })`)
    await evaluate(`contactBoot.seedMessage({ peer: '${peer}', at: ${base + 200}, text: 'Latest contact text' })`)
    const newest = await evaluate(`contactBoot.seedMessage({ peer: '${other}', at: ${base + 300}, filename: 'trip.pdf', caption: 'Trip caption' })`)
    await browser.until(() => evaluate(`['${pubkey}', '${peer}', '${other}', '${empty}'].every(peer=>contactBoot.account.summaries$()[peer]?.state==='loaded')`), 'fixture summaries settle before the cold-cache opening')
    await evaluate('window.dispatchEvent(new Event("pagehide"))')
    await browser.until(async () => (await evaluate('contactBoot.readSummaryCache()')).some(record => record.peer === other), 'fixture cache exists before the cold-cache opening')
    await evaluate('contactBoot.clearSummaryCache()')
    await collect()
    console.log('Reloading cold home')
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 320, deviceScaleFactor: 1, mobile: true }, session)
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
    const histories = () => evaluate("contactBoot.reads.filter(read => read.method === 'subscribe' && read.options?.initial && read.filter.limit === 25 && read.filter['#k']?.includes('9'))")
    console.log('Checking visible prefetch')
    await collect()
    const visible = await evaluate(`(() => {
      const home = document.querySelector('.route-page[data-active=true] .home');
      const top = home.querySelector('.contacts-divider').getBoundingClientRect().bottom;
      return [...home.querySelectorAll('[data-prefetch-peer]')].filter(row => {
        const rect = row.getBoundingClientRect(); return rect.bottom > top && rect.top < innerHeight;
      }).map(row => row.dataset.prefetchPeer);
    })()`)
    assert.ok(visible.includes(other))
    assert.ok(visible.includes(peer), 'two contact chats are visible')
    assert.ok(!visible.includes(pubkey), 'self chat starts below the viewport')
    await browser.until(() => evaluate(`${JSON.stringify(visible)}.every(peer => contactBoot.account.conversations$()[peer]?.historyLoaded)`), 'visible first pages finish without entering a chat')
    assert.equal(await evaluate('contactBoot.account.historyLoaded$()'), false, 'offscreen self history stays lazy')
    assert.equal(await evaluate('contactBoot.account.messages$().length'), 0)
    const reads = await evaluate('contactBoot.reads')
    assert.equal(reads.filter(read => read.method === 'subscribe' && read.options?.initial && read.filter.limit === 1 && read.filter['#k']?.includes('9')).length, 4)
    assert.equal((await histories()).length, visible.length, 'only visible chats open a first page')
    assert.ok(!reads.some(read => read.filter.kinds?.includes(34601)), 'prefetch only reads metadata')
    assert.deepEqual(await evaluate('contactBoot.mediaStates'), [], 'home never starts thumbnail/original transfers')
    if (visible.includes(peer)) {
      await browser.until(() => evaluate(`contactBoot.account.conversations$()['${peer}'].references?.[contactBoot.account.conversations$()['${peer}'].messages.find(event => event.id === '${olderFile}')?.tags.find(tag => tag[0] === 'q')?.[1]]?.kind === 1063`), 'first-page attachment metadata is resolved before visiting')
      assert.equal(await evaluate(`contactBoot.account.conversations$()['${peer}'].messages.length`), 6, 'the first page contains the local history')
      assert.equal(await evaluate(`contactBoot.account.conversations$()['${peer}'].messages.some(event => event.id === '${olderFile}')`), true)
    }
    const beforeOpen = (await histories()).length
    await evaluate(`document.querySelector('.conversation button[data-contact-id="${other}"]').click()`)
    await browser.until(() => evaluate('document.querySelectorAll(\'.route-page[data-active=true] [data-message-id]\').length === 2'), 'prefetched bubbles appear on entry')
    assert.equal((await histories()).length, beforeOpen, 'opening completed prefetch does not restart history')
    assert.equal(await evaluate('!!document.querySelector(\'.route-page[data-active=true] .chat-date[role=status]:not([hidden])\')'), false)
    await evaluate('document.querySelector(".route-page[data-active=true] .chat-back").click()')
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .conversations")'), 'return to home')
    assert.equal(await evaluate('contactBoot.decryptionPriorities.at(-1)'), null, 'leaving the active chat clears its retry priority')

    const selfContext = await evaluate(`window.nostr.obfuscate('dm:${pubkey}', '1006', '')`)
    const selfHistories = async () => (await histories()).filter(read => read.filter['#c']?.includes(selfContext))
    await evaluate('contactBoot.holdHistory()')
    await evaluate(`(async () => {
      const scroll = document.querySelector('.route-page[data-active=true] .route-scroll');
      for (let n = 0; n < 6; n++) {
        scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight - (n % 2 ? 0 : 10);
        scroll.dispatchEvent(new Event('scroll'));
        await new Promise(resolve => setTimeout(resolve, 70));
      }
    })()`)
    assert.equal(await evaluate('contactBoot.account.messages$().length'), 0, 'continuous scrolling does not start offscreen history')
    await browser.until(() => evaluate(`contactBoot.account.messages$().some(event => event.id === '${selfLatest}')`), 'self chat prefetch starts after scrolling settles')
    await browser.until(async () => (await selfHistories()).length > 0, 'in-flight self history subscription is registered')
    const inFlight = (await selfHistories()).length
    await evaluate('document.querySelector(\'.route-page[data-active=true] .conversation button[data-contact-id="user"]\').click()')
    await browser.until(() => evaluate(`document.querySelector('.route-page[data-active=true] [data-message-id="${selfLatest}"] .chat-bubble')?.textContent.includes('self-notes')`), 'opening in-flight prefetch reuses its cached latest bubble')
    assert.equal(await evaluate('contactBoot.account.historyLoaded$()'), false)
    await evaluate(`contactBoot.lastBubble = document.querySelector('.route-page[data-active=true] [data-message-id="${selfLatest}"] .chat-bubble')`)
    await evaluate('contactBoot.releaseHistory()')
    await browser.until(() => evaluate('document.querySelectorAll(\'.route-page[data-active=true] [data-message-id]\').length === 2'), 'earlier messages appear before EOSE')
    assert.equal(await evaluate('contactBoot.account.historyLoaded$()'), false)
    await evaluate('contactBoot.releaseEose()')
    await browser.until(() => evaluate('contactBoot.account.historyLoaded$()'), 'promoted history completes')
    assert.equal((await selfHistories()).length, inFlight, 'foreground promotion shares the in-flight subscription')
    assert.equal(await evaluate(`document.querySelector('.route-page[data-active=true] [data-message-id="${selfLatest}"] .chat-bubble') === contactBoot.lastBubble`), true)
    await evaluate('document.querySelector(".route-page[data-active=true] .chat-back").click()')
    await browser.until(() => evaluate('!!document.querySelector(".route-page[data-active=true] .conversations")'), 'return from self chat')
    const incoming = await evaluate(`contactBoot.seedMessage({ peer: '${peer}', at: ${base + 400}, filename: 'fresh.pdf' })`)
    await browser.until(async () => (await rows())[0]?.preview === 'fresh.pdf', 'new local message reorders unopened contact')
    await evaluate(`napp.eventStore.addPersonalCopy({kind:5,created_at:Math.floor(Date.now()/1000),tags:[['e','${incoming}'],['k','9']],content:''},{context:'dm:${peer}'})`)
    await browser.until(async () => { const list = await rows(); return list[0]?.id === other && list[1]?.preview === 'Latest contact text' }, 'deleting latest message restores ordering and preview without opening chat')
    assert.equal((await rows())[1].preview, 'Latest contact text')
    await evaluate(`napp.eventStore.addPersonalCopy({kind:5,created_at:Math.floor(Date.now()/1000),tags:[['e','${newest}'],['k','9']],content:''},{context:'dm:${other}'})`)
    await browser.until(async () => { const list = await rows(); return list[0]?.id === peer && list[2]?.preview === 'Older message 0' }, 'another deletion falls back to older local history')
    console.log('Cold ordering, visible-only prefetch, first-page limit, metadata, scroll debounce, completed/in-flight handoff and live updates verified')
    // The same installation retains the encrypted projection. Hold every
    // authoritative summary delivery after reload, including the empty contact;
    // restored, source-validated rows must still start visible history work.
    await browser.until(() => evaluate(`['${pubkey}', '${peer}', '${other}', '${empty}'].every(peer=>contactBoot.account.summaries$()[peer]?.state==='loaded')`), 'summaries settle before persisting the warm projection')
    const warmRows = await rows()
    const warmIds = await evaluate(`Object.fromEntries(['${pubkey}', '${peer}', '${other}'].map(peer=>[peer,contactBoot.account.summaries$()[peer].event.id]))`)
    await evaluate('window.dispatchEvent(new Event("pagehide"))')
    await browser.until(async () => {
      const snapshot = await evaluate('contactBoot.readSummaryCache()')
      return Object.entries(warmIds).every(([peer, id]) => snapshot.some(record => record.peer === peer && record.event.id === id))
    }, 'complete projection is persisted through the real encrypted cache')
    // Reclaim discarded startup/visited-route objects before the warm phase;
    // all Chrome, vault and watcher processes share the guarded 3 GiB budget.
    await collect()
    const appContext = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault)
    await browser.send('Emulation.setCPUThrottlingRate', { rate: 4 }, appContext.sessionId)
    await browser.evaluate(`(() => {
      const frame=[...document.querySelectorAll('app-window iframe')].find(frame=>new URL(frame.src).origin===${JSON.stringify(origin)});
      const url=new URL(frame.src);url.pathname='/';url.search='?holdContacts=1&holdOutbox=1&holdSummaries=1';frame.src=url.href;
    })()`)
    await browser.until(() => evaluate('contactBoot.cacheFinished !== undefined && contactBoot.contactReads === 1'), 'real cache decrypts while contact membership is still held', 5000)
    assert.equal(await evaluate('contactBoot.account.contactsState$()'), 'loading')
    assert.equal(await evaluate('Object.keys(contactBoot.account.summaries$()).length'), 0, 'decrypted previews stay private until membership is confirmed')
    assert.equal(await evaluate('(contactBoot.channelPreparations || []).length'), 0, 'bulk channel preparation waits for the cached list')
    assert.equal(await evaluate('contactBoot.reads.some(read=>read.filter["#k"]?.includes("30078"))'), false, 'bulk read anchors also wait')
    assert.equal(await evaluate('(contactBoot.decryptionAdmissions || []).some(entry=>entry.ready)'), false, 'pending decryption stays suspended while membership is held')
    assert.equal(await evaluate('contactBoot.cacheReads'), 1)
    await evaluate('contactBoot.releaseContacts()')
    await browser.until(() => evaluate('contactBoot.summaryFrames.length>0'), 'encrypted projection restores home rows while source summaries wait', 5000)
    const firstFrame = await evaluate('contactBoot.summaryFrames[0]')
    assert.deepEqual(firstFrame.rows, warmRows, 'the first restored frame keeps previews and latest-message order')
    assert.ok(firstFrame.at < 5000)
    await browser.until(() => evaluate('(contactBoot.channelPreparations || []).length > 0'), 'bulk channels resume after cached rows render')
    assert.deepEqual(await evaluate('contactBoot.channelPreparations[0].rows'), warmRows.map(row => row.id), 'cached rows render before bulk channels start')
    await browser.until(() => evaluate('(contactBoot.decryptionAdmissions || []).some(entry=>entry.ready)'), 'pending decryption is released after restored rows render')
    assert.deepEqual(await evaluate('contactBoot.decryptionAdmissions.find(entry=>entry.ready).rows'), warmRows.map(row => row.id))
    assert.equal(await evaluate('contactBoot.cacheReads'), 1, 'membership confirmation reuses the prepared snapshot')
    assert.equal(await evaluate(`contactBoot.account.summaries$()['${empty}']?.state`), 'loading', 'an empty offscreen contact remains pending')
    await browser.until(() => evaluate('contactBoot.reads.some(read=>read.method==="subscribe" && read.filter.limit===25)'), 'visible prefetch starts without waiting for every summary')
    console.log(`Warm summaries: first cached rows in ${Math.round(firstFrame.at)} ms with 4x CPU throttling; all source summaries still held.`)
    await evaluate(`document.querySelector('.conversation button[data-contact-id="${peer}"]').click()`)
    await browser.until(() => evaluate(`document.querySelector('.route-page[data-active=true] [data-message-id="${warmIds[peer]}"] .chat-bubble')?.textContent.includes('Latest contact text')`), 'verified persistent snapshot immediately seeds the foreground bubble')
    assert.equal(await evaluate(`Boolean(contactBoot.account.conversations$()['${peer}'].historyLoaded)`), false, 'the remaining first page is still held')
    assert.equal(await evaluate('contactBoot.decryptionPriorities.at(-1)'), peer, 'the active conversation gets retry priority')
    await evaluate('contactBoot.releaseSummaries();contactBoot.releaseHistory();contactBoot.releaseEose();contactBoot.releaseQueue()')
    await browser.until(() => evaluate(`['${pubkey}', '${peer}', '${other}', '${empty}'].every(peer=>contactBoot.account.summaries$()[peer]?.state==='loaded')`), 'warm summaries revalidate after release')
    await evaluate('contactBoot.releaseQueue()')
  } catch (error) {
    console.error(error)
    console.log('Summary errors:', summaryErrors.slice(-5))
    for (const context of browser?.contexts.values() ?? []) {
      if (!/^http:\/\/[0-9]+[.]localhost:10000$/.test(context.origin) || !context.auxData?.isDefault) continue
      console.log('Summary cache diagnostic:', await browser.evaluate(`(async()=>({
        summaries:Object.fromEntries(Object.entries(contactBoot.account.summaries$()).map(([peer,record])=>[peer,{state:record.state,id:record.event?.id,at:record.event?.created_at,copies:record.copies?.length}])),
        cache:{started:contactBoot.cacheStarted,finished:contactBoot.cacheFinished,reads:contactBoot.cacheReads},
        channels:contactBoot.channelPreparations,
        frames:contactBoot.summaryFrames.slice(0,2),
        reads:contactBoot.reads.slice(-5)
      }))()`, context.origin).catch(() => null))
      break
    }
    await browser?.diagnose(path.join(root, 'tmp/browser-failures/home-summaries'))
    throw error
  } finally {
    clearInterval(permissions)
    await browser?.close()
    await runtime.close()
  }
})
