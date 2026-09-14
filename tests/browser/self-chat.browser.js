import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { noteEncode, appEncode } from 'libp2r2p/nip19'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'
import { compile, root } from '../../bin/build-options.js'
import { ensureRuntime } from '../../../../44billion/bin/dev-runtime.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'
import { prepareTestApp } from '../../../../44billion/tests/browser/runtime/prepare-app.js'
import { checkScrollScenarios } from './scroll-scenarios.js'

const launcherOrigin = 'http://localhost:10000'
const vaultOrigin = 'http://localhost:4000'

test('real self chat persists offline, quotes inner IDs and receives event-store updates', { timeout: 300000 }, async () => {
  const runtime = await ensureRuntime({ log: () => {} })
  let browser
  let permissions
  let allowPermissions = true
  let offline = true
  const requests = []
  const held = []
  const media = {
    hold: false,
    async release () {
      while (held.length) {
        held.shift()()
        await new Promise(resolve => setTimeout(resolve, 35))
      }
    }
  }
  try {
    const app = await prepareTestApp(await compile({ development: true, futureFeatures: true }), { identifier: 'self-chat-test', name: 'Self chat test' })
    browser = await launchChrome({
      intercept: request => {
        const url = new URL(request.url)
        if (/^(?:[a-z0-9-]+\.)*localhost$/.test(url.hostname)) return null
        requests.push(request.url)
        if (offline) return false
        if (url.pathname.startsWith('/scroll-')) {
          if (media.reject) return false
          const response = {
            responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII='
          }
          return media.hold ? new Promise(resolve => held.push(() => resolve(response))) : media.stagger ? new Promise(resolve => setTimeout(() => resolve(response), 150 + (Number(url.pathname.match(/\d+/)?.[0]) % 3 || 0) * 75)) : response
        }
        if (url.pathname.endsWith('/favicon.ico') || url.pathname === '/brand.png') {
          return {
            responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/png' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII='
          }
        }
        if (['/article', '/plain'].includes(url.pathname) || (url.hostname === 'njump.me' && !url.pathname.includes('missing'))) {
          return {
            responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/html' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: Buffer.from(`<html><head><link rel="icon" href="/brand.png">${url.pathname === '/plain' ? '' : '<meta property="og:title" content="Preview title"><meta property="og:description" content="Preview description"><meta property="og:image" content="https://example.com/photo.png">'}<script>window.previewScriptExecuted=true</script></head><body>Untrusted body</body></html>`).toString('base64')
          }
        }
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
    media.origin = origin
    const evaluate = expression => browser.evaluate(expression, origin)
    permissions = setInterval(() => {
      if (allowPermissions) browser.evaluate('document.querySelector(".permission-button.allow-button:not(:disabled)")?.click()').catch(() => {})
    }, 100)
    // Reloading the launcher also reloads the vault; unlock through its real UI.
    await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("lock-overlay .lock-unlock"))', vaultOrigin), 'vault unlock UI')
    await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vaultOrigin)
    await browser.until(() => browser.evaluate('Boolean(document.querySelector("vault-lock-button") && !document.querySelector("vault-lock-button").hidden)', vaultOrigin), 'unlocked vault')

    await browser.until(() => evaluate('Boolean(document.querySelector(".conversation [data-contact-id=user]"))'), 'self conversation')
    await evaluate('document.querySelector(".conversation [data-contact-id=user]").click()')
    await browser.until(() => evaluate('document.querySelector(".chat-header h1")?.textContent === "You"'), 'real self chat')
    assert.equal(await evaluate('document.querySelectorAll(".chat-bubble").length'), 0)
    assert.equal(await evaluate('document.querySelector(".chat-attention")'), null)
    await evaluate('document.querySelector(".chat-more").click()')
    await browser.until(() => evaluate('!!document.querySelector(".chat-menu")'), 'self menu')
    assert.equal(await evaluate('document.querySelector(".chat-attention-option")'), null)
    await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape"}))')
    const setText = text => evaluate(`(() => { const input = document.querySelector('.chat-composer textarea'); input.value = ${JSON.stringify(text)}; input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    const emptyComposerHeight = await evaluate('document.querySelector(".chat-composer textarea").clientHeight')
    await setText('Today\nhttps://example.com/photo.png #private')
    await browser.until(() => evaluate(`document.querySelector('.chat-composer textarea').clientHeight > ${emptyComposerHeight}`), 'multiline draft grows the composer')
    await browser.until(() => evaluate('document.querySelector(".compose-action").getAttribute("aria-disabled") === "false"'), 'enabled Send')
    await browser.until(() => evaluate('document.querySelector(".chat-timeline").dataset.initialLoading === "false"'), 'initial history processed')
    allowPermissions = false
    // Reading history already grants kind-9 access. Revoke that real grant in
    // this disposable profile so the next write waits on the actual dialog.
    // No signer, event-store method or permission provider is substituted.
    await browser.evaluate(`(async () => {
      for (const {name} of await indexedDB.databases()) {
        const db = await new Promise((resolve, reject) => {
          const request = indexedDB.open(name);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        try {
          if (!db.objectStoreNames.contains('permissions')) continue;
          await new Promise((resolve, reject) => {
            const tx = db.transaction('permissions', 'readwrite');
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
            const request = tx.objectStore('permissions').openCursor();
            request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) return;
              if (cursor.value.eKind === 9) cursor.delete();
              cursor.continue();
            };
          });
        } finally { db.close(); }
      }
    })()`)
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('document.querySelector(".message-status")?.dataset.status === "pending"'), 'optimistic pending message')
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").value === ""'), 'draft cleared before save')
    await browser.until(() => evaluate(`document.querySelector('.chat-composer textarea').clientHeight === ${emptyComposerHeight} && getComputedStyle(document.querySelector('.chat-composer textarea')).overflowY === 'hidden'`), 'sent draft returns to one line without another input event', 3000)
    await browser.until(() => evaluate('Boolean(document.querySelector(".chat-media a"))'), 'media link')
    assert.equal(await evaluate('document.querySelector(".chat-media a").href'), 'https://example.com/photo.png')
    assert.equal(await evaluate('document.querySelector(".chat-media img")'), null, 'uncached offline image stays a link')
    const id = await evaluate('document.querySelector(".message-row").dataset.messageId')
    await browser.until(() => browser.evaluate('!!document.querySelector(".permission-button.deny-button:not(:disabled)")'), 'real write permission held')
    await browser.until(() => evaluate('!document.querySelector(".chat-bubble").getAnimations({subtree:true}).length'), 'initial text and link presentation settled before comparing status geometry')
    const geometry = () => evaluate(`(() => {
      const bubble = document.querySelector('.chat-bubble').getBoundingClientRect();
      const status = document.querySelector('.message-status').getBoundingClientRect();
      return {bubbleWidth:bubble.width, bubbleHeight:bubble.height, statusWidth:status.width, statusHeight:status.height};
    })()`)
    const pendingGeometry = await geometry()
    await evaluate(`(() => {
      window.pendingBubble = document.querySelector('.chat-bubble');
      window.statusSizes = [];
      window.statusObserver = new ResizeObserver(() => {
        const bubble = pendingBubble.getBoundingClientRect();
        const status = pendingBubble.querySelector('.message-status').getBoundingClientRect();
        statusSizes.push({bubbleWidth:bubble.width, bubbleHeight:bubble.height, statusWidth:status.width, statusHeight:status.height});
      });
      statusObserver.observe(pendingBubble);
      statusObserver.observe(pendingBubble.querySelector('.message-status'));
    })()`)
    assert.equal(pendingGeometry.statusWidth, 14, 'pending metadata uses only the icon width')
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".message-status time")).display'), 'none')
    assert.equal(await evaluate('document.querySelector(".message-status icon-clock").getAnimations({subtree:true}).length'), 0)
    await setText('Next draft\nstays here')
    await browser.evaluate('document.querySelector(".permission-button.deny-button").click()')
    await browser.until(() => evaluate('document.querySelector(".message-status")?.dataset.status === "error"'), 'denied write shows bubble error')
    assert.deepEqual(await geometry(), pendingGeometry, 'failure preserves bubble and time slot dimensions')
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Next draft\nstays here')
    await evaluate('document.querySelector(".chat-back").click()')
    await browser.until(() => evaluate('location.pathname === "/"'), 'leave failed message route')
    await evaluate('history.forward()')
    await browser.until(() => evaluate('location.pathname === "/chat/user"'), 'return to failed message')
    assert.equal(await evaluate('document.querySelector(".message-status").dataset.status'), 'error', 'retained routes preserve retryable failures')
    await evaluate('document.querySelector(".message-status button").click()')
    await browser.until(() => evaluate('!!document.querySelector(".message-retry")'), 'error opens Retry menu')
    await evaluate('document.querySelector(".message-retry").click()')
    await browser.until(() => evaluate('document.querySelector(".message-status")?.dataset.status === "pending"'), 'retry restores clock')
    assert.deepEqual(await geometry(), pendingGeometry, 'retry preserves dimensions')
    allowPermissions = true
    await browser.until(() => evaluate('document.querySelector(".message-status")?.dataset.status === "saved"'), 'retried message saved', 45000)
    await browser.until(() => evaluate('!document.querySelector(".chat-bubble").getAnimations({subtree:true}).length'), 'confirmation expansion finishes')
    const savedGeometry = await geometry()
    assert.ok(savedGeometry.statusWidth > pendingGeometry.statusWidth, 'confirmation reveals the wider time')
    assert.equal(savedGeometry.statusHeight, pendingGeometry.statusHeight)
    assert.equal(savedGeometry.bubbleHeight, pendingGeometry.bubbleHeight)
    assert.equal(await evaluate('window.pendingBubble === document.querySelector(".chat-bubble")'), true)
    assert.equal(await evaluate('document.querySelectorAll(".chat-bubble").length'), 1, 'retry never duplicates the bubble')
    assert.equal(await evaluate('document.querySelector(".message-row").dataset.messageId'), id)
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".message-status time")).visibility'), 'visible')
    assert.equal(await evaluate('document.querySelector(".message-status .status-indicator")'), null)
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), 'Next draft\nstays here')
    // Retained routes temporarily have no layout. Visible expansion frames
    // stay between the icon and time widths, with unchanged metadata height.
    const sizes = await evaluate('statusSizes.filter(size => size.bubbleWidth > 0)')
    for (const size of sizes) {
      assert.equal(size.statusHeight, pendingGeometry.statusHeight)
      assert.ok(size.statusWidth >= 14 && size.statusWidth <= savedGeometry.statusWidth)
    }
    assert.ok(sizes.some(size => size.statusWidth > 14 && size.statusWidth < savedGeometry.statusWidth), 'real write confirmation paints intermediate widths')
    await evaluate('statusObserver.disconnect(); delete window.statusObserver; delete window.statusSizes; delete window.pendingBubble')
    await setText('')
    await evaluate('document.querySelector(".chat-bubble").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }))')
    await browser.until(() => evaluate('Boolean(document.querySelector(".message-actions"))'), 'message actions')
    await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
    await browser.until(() => evaluate('Boolean(document.querySelector(".composer-reply"))'), 'reply preview')
    assert.equal(await evaluate('document.querySelector(".composer-reply span").textContent'), 'Reply: Today\nexample.com/photo.png #private')
    await setText('Reply to my note')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('document.querySelectorAll(".chat-bubble").length === 2'), 'saved reply')
    await browser.until(() => evaluate('document.querySelectorAll(".message-status[data-status=saved]").length === 2'), 'reply persistence confirmed')
    assert.equal(await evaluate('document.querySelectorAll(".message-quote").length'), 1)
    assert.equal(await evaluate('document.querySelector(".quote-text").textContent'), 'Today\nexample.com/photo.png #private')
    assert.equal(await evaluate('document.querySelector(".quote-text").title'), 'Today\nhttps://example.com/photo.png #private')
    const readMessages = `window.napp.eventStore.query({ kinds: [1006], '#k': ['9'] }).then(async ({ results }) => Promise.all(results.map(async wrapper => JSON.parse(new TextDecoder().decode(await window.nostr.nip44v3.decrypt(${JSON.stringify(pubkey)}, 9, '', wrapper.content))))))`
    const events = await evaluate(readMessages)
    assert.deepEqual(await evaluate(`(async () => {
      const owner = ${JSON.stringify(pubkey)};
      const bytes = new Uint8Array([0, 255, 251, 128, 63]);
      const signers = [window.nostr, window.napp.getWindowNostrFor(owner), window.nostr.ns('')];
      for (const signer of signers) {
        const encrypted = await signer.nip44v3.encrypt(owner, 9, '', bytes.buffer);
        const decrypted = await signer.nip44v3.decrypt(owner, 9, '', encrypted);
        if (!(decrypted instanceof ArrayBuffer) || String(new Uint8Array(decrypted)) !== String(bytes)) throw new Error('Binary NIP-07 round-trip failed');
      }
      const [ciphertext, senderContentPubkey] = await window.nostr.nip44v3.encryptDoubleDH(owner, 9, '', bytes.buffer);
      const plain = await window.nostr.nip44v3.decryptDoubleDH(owner, 9, '', ciphertext, senderContentPubkey, senderContentPubkey);
      if (!(plain instanceof ArrayBuffer)) throw new Error('Double DH did not return an ArrayBuffer');
      return Array.from(new Uint8Array(plain));
    })()`), [0, 255, 251, 128, 63], 'real vault preserves arbitrary bytes across default, persona, namespace and Double DH APIs')
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
    await browser.until(() => evaluate('document.querySelector(".quote-thumbnail")?.naturalWidth > 0'), 'posted reply uses the cached thumbnail offline')
    // Real messages share the fixture bubble geometry and group by calendar day.
    const addNote = (content, createdAt = Math.floor(Date.now() / 1000)) => evaluate(`window.napp.eventStore.addPersonalCopy({kind:9, created_at:${createdAt}, tags:[], content:${JSON.stringify(content)}}, {context:${JSON.stringify(`dm:${pubkey}`)}})`)
    await addNote('Hi')
    await browser.until(() => evaluate('[...document.querySelectorAll(".chat-bubble")].some(el => el.querySelector(".chat-content")?.innerText === "Hi")'), 'verbatim short text')
    assert.ok(await evaluate(`(() => {
      const el = [...document.querySelectorAll('.chat-bubble')].find(el => el.querySelector('.chat-content')?.innerText === 'Hi');
      return el.getBoundingClientRect().height < 45 && !el.querySelector('time').innerText.includes('/') && el.querySelector('time').innerText.length < 10;
    })()`), 'short messages have one line with clock metadata')
    await addNote('Yesterday note', Math.floor(Date.now() / 1000) - 86400)
    await browser.until(() => evaluate('document.querySelectorAll(".message-list .chat-date").length === 2'), 'day separators')
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".message-list .chat-date")].map(el=>el.textContent)'), ['Yesterday', 'Today'])

    offline = false
    await evaluate('window.dispatchEvent(new Event("online"))')
    await addNote('https://example.com/article')
    await browser.until(() => evaluate('document.querySelector(".website-preview strong")?.innerText === "Preview title"'), 'Open Graph preview')
    await browser.until(() => evaluate('document.querySelector(".reference-icon")?.naturalWidth > 0 && document.querySelector(".preview-image")?.naturalWidth > 0'), 'preview images')
    assert.equal(await evaluate('window.previewScriptExecuted'), undefined)
    assert.equal(await evaluate('document.querySelector(\'.reference-link[href="https://example.com/article"] .reference-label\').innerText'), 'example.com/article')
    assert.equal(await evaluate('[...document.querySelectorAll(\'.reference-link, .chat-media a, .chat-reference\')].every(link => getComputedStyle(link).textDecorationLine === \'none\')'), true)
    await addNote('https://example.com/plain')
    await browser.until(() => evaluate('document.querySelector(\'.reference-link[href="https://example.com/plain"] img\')?.naturalWidth > 0'), 'declared icon without OG')
    await addNote('https://blocked.example.com/page')
    await browser.until(() => evaluate('document.querySelector(\'.reference-link[href="https://blocked.example.com/page"] img\')?.naturalWidth > 0'), 'favicon fallback after unreadable HTML')
    const publicPointer = noteEncode('a'.repeat(64))
    await addNote(`https://njump.me/${publicPointer}`)
    await browser.until(() => evaluate(`!!document.querySelector('.reference-link[href="https://njump.me/${publicPointer}"]')`), 'public Nostr preview')
    await browser.until(() => evaluate('document.querySelectorAll(".preview-image").length === 2 && [...document.querySelectorAll(".preview-image")].every(image => image.naturalWidth > 0)'), 'both preview images')
    // Watch old content throughout insertion and asynchronous preview resolution,
    // not just after a cache hit has restored the final DOM.
    await evaluate(`(() => {
      const nodes = [...document.querySelectorAll('.website-preview, .preview-image, .reference-icon, .chat-media img, .quote-thumbnail')];
      const changes = [];
      const observer = new MutationObserver(records => {
        for (const record of records) {
          for (const removed of record.removedNodes) {
            if (nodes.some(node => removed === node || removed.contains(node))) changes.push('removed');
          }
          if (record.type === 'attributes' && nodes.includes(record.target)) changes.push('source changed');
        }
      });
      observer.observe(document.querySelector('.message-list'), {subtree:true, childList:true, attributes:true, attributeFilter:['src']});
      window.previewStability = {nodes, changes, observer};
    })()`)
    await addNote('Unrelated new message https://example.com/article')
    await browser.until(() => evaluate('document.querySelectorAll(".website-preview").length === 3 && [...document.querySelectorAll(".preview-image")].filter(image => image.naturalWidth > 0).length === 3'), 'new message preview')
    assert.deepEqual(await evaluate('window.previewStability.changes'), [], 'existing previews never collapse while another message is added or enriched')
    assert.equal(await evaluate('window.previewStability.nodes.every(node => node.isConnected)'), true)
    await evaluate('window.previewStability.observer.disconnect(); delete window.previewStability')
    const privatePointer = noteEncode(id) + appEncode({ pubkey, dTag: 'zillion', channel: 'main' })
    const requestStart = requests.length
    await addNote(privatePointer)
    await browser.until(() => evaluate(`!!document.querySelector('.reference-link[href="nostr:${privatePointer}"]')`), 'private Nostr link retained')
    assert.equal(requests.slice(requestStart).some(url => url.includes(noteEncode(id))), false, 'private pointer never reaches njump')
    assert.equal(await evaluate(`document.querySelector('.reference-link[href="nostr:${privatePointer}"]').textContent`), privatePointer.slice(0, 22) + '…')
    assert.equal(await evaluate(`document.querySelector('.reference-link[href="nostr:${privatePointer}"]').getAttribute('aria-label')`), privatePointer)
    assert.equal(await evaluate(`document.querySelector('.reference-link[href="nostr:${privatePointer}"]').title`), privatePointer)
    await addNote(`https://njump.me/${noteEncode(id)}`)
    await browser.until(() => evaluate(`!!document.querySelector('.reference-link[href="nostr:${noteEncode(id)}"]')`), 'private njump URL stays local')
    assert.equal(requests.slice(requestStart).some(url => url.includes(noteEncode(id))), false)

    const startReply = async (target, title) => {
      await evaluate(`(async () => {
        const bubble = (${target}).closest('.chat-bubble');
        bubble.scrollIntoView({block:'center'});
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        bubble.dispatchEvent(new MouseEvent('contextmenu', {bubbles:true, cancelable:true}));
      })()`)
      await browser.until(() => evaluate('!!document.querySelector(".message-actions [aria-label=Reply]")'), 'reply action')
      await evaluate('document.querySelector(".message-actions [aria-label=Reply]").click()')
      await browser.until(() => evaluate(`document.querySelector('.reply-text')?.title === ${JSON.stringify(title)}`), 'selected reply')
    }
    await startReply(`document.querySelector('.reference-link[href="nostr:${privatePointer}"]')`, privatePointer)
    assert.equal(await evaluate('document.querySelector(".reply-thumbnail")'), null)
    assert.equal(requests.slice(requestStart).some(url => url.includes(noteEncode(id))), false, 'reply thumbnails keep personal pointers local')
    await startReply('document.querySelector(\'.reference-link[href="https://example.com/article"]\')', 'https://example.com/article')
    await browser.until(() => evaluate('document.querySelector(".reply-thumbnail")?.naturalWidth > 0'), 'OG reply thumbnail')
    assert.equal(await evaluate('document.querySelectorAll(".reply-thumbnail").length'), 1)
    await evaluate('document.querySelector(".cancel-reply").click()')
    await browser.until(() => evaluate('!document.querySelector(".composer-reply")'), 'cancel reply')
    const longReply = 'Long reply ' + 'unbroken'.repeat(180)
    await addNote(longReply)
    await browser.until(() => evaluate(`!![...document.querySelectorAll('.chat-content')].find(el => el.innerText === ${JSON.stringify(longReply)})`), 'long reply target')
    await startReply(`[...document.querySelectorAll('.chat-content')].find(el => el.innerText === ${JSON.stringify(longReply)})`, longReply)
    await setText('Reply to long text')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate(`!![...document.querySelectorAll('.quote-text')].find(el => el.title === ${JSON.stringify(longReply)})`), 'posted reply to long text')

    const queryUrl = 'https://tabler.io/icons?icon=server-bolt'
    await setText(queryUrl)
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").value === "" || document.querySelector(".toast-message")?.textContent === "Could not save message"'), 'query-string message outcome')
    assert.equal(await evaluate('document.querySelector(".chat-composer textarea").value'), '', 'query-string message sends successfully')
    await browser.until(() => evaluate(`!!document.querySelector('.reference-link[href="${queryUrl}"]')`), 'query-string link rendered intact')
    await browser.until(() => evaluate(`document.querySelector('.reference-link[href="${queryUrl}"]').closest('.chat-bubble').querySelector('.message-status').dataset.status === 'saved'`), 'query-string message persisted')
    assert.equal((await evaluate(readMessages)).filter(event => event.content === queryUrl).length, 1, 'query-string content is stored verbatim once')

    const wrappingDraft = 'Long draft with automatic wrapping. '.repeat(40).trimEnd()
    await setText(wrappingDraft)
    await browser.until(() => evaluate('getComputedStyle(document.querySelector(".chat-composer textarea")).overflowY === "auto"'), 'wrapped draft reaches the five-line limit')
    await evaluate('document.querySelector(".compose-action").click()')
    await browser.until(() => evaluate('document.querySelector(".chat-composer textarea").value === ""'), 'wrapped draft cleared after acceptance')
    await browser.until(() => evaluate(`document.querySelector('.chat-composer textarea').clientHeight === ${emptyComposerHeight} && getComputedStyle(document.querySelector('.chat-composer textarea')).overflowY === 'hidden'`), 'wrapped draft releases its height and scrollbar after sending', 3000)
    await browser.until(() => evaluate(`!![...document.querySelectorAll('.chat-content')].find(el => el.innerText === ${JSON.stringify(wrappingDraft)})`), 'wrapped message rendered intact')
    await browser.until(() => evaluate('!document.querySelector(".message-status[data-status=pending], .message-status[data-status=error]")'), 'all composer messages saved before reload scenarios')

    await mkdir(path.join(root, 'tmp/browser-failures'), { recursive: true })
    const session = [...browser.contexts.values()].find(context => context.origin === launcherOrigin && context.auxData?.isDefault).sessionId
    for (const width of [390, 1100]) {
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 500 }, session)
      for (const theme of ['light', 'dark']) {
        for (const sessionId of new Set([...browser.contexts.values()].filter(context => context.auxData?.frameId).map(context => context.sessionId))) await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] }, sessionId)
        assert.equal(await evaluate('document.querySelector(".chat-timeline").scrollWidth <= document.querySelector(".chat-timeline").clientWidth'), true)
        assert.equal(await evaluate(`(() => {
          const text = [...document.querySelectorAll('.quote-text')].find(el => el.title === ${JSON.stringify(longReply)});
          const quote = text.closest('.message-quote');
          const thumbnail = document.querySelector('.quote-thumbnail');
          const copy = thumbnail.parentElement.querySelector('.quote-copy').getBoundingClientRect();
          const image = thumbnail.getBoundingClientRect();
          return text.scrollWidth > text.clientWidth && getComputedStyle(text).textOverflow === 'ellipsis'
            && getComputedStyle(text).whiteSpace === 'nowrap' && Math.abs(text.getBoundingClientRect().height - 18.9) < 1
            && quote.scrollWidth === quote.clientWidth && image.width === 38 && image.height === 38
            && Math.abs(copy.height - image.height) < 1 && image.right < copy.left
            && thumbnail.parentElement.querySelectorAll('.quote-thumbnail').length === 1;
        })()`), true, 'posted quotes ellipsize one text line and size the thumbnail to author plus excerpt')
        await writeFile(path.join(root, `tmp/browser-failures/self-chat-${width}-${theme}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, session)).data, 'base64'))
        await startReply('[...document.querySelectorAll(".chat-content")].find(el => el.innerText === "Hi")', 'Hi')
        assert.equal(await evaluate(`(() => {
          const text = document.querySelector('.reply-text').getBoundingClientRect();
          const button = document.querySelector('.cancel-reply').getBoundingClientRect();
          return text.height === 22 && Math.abs(text.top + text.height / 2 - button.top - button.height / 2) < 1;
        })()`), true, 'one-line reply stays vertically centered')
        await startReply(`[...document.querySelectorAll('.chat-content')].find(el => el.innerText === ${JSON.stringify(longReply)})`, longReply)
        assert.equal(await evaluate(`(() => {
          const text = document.querySelector('.reply-text');
          const button = document.querySelector('.cancel-reply').getBoundingClientRect();
          const composer = document.querySelector('.chat-composer').getBoundingClientRect();
          return text.clientHeight === 44 && text.scrollHeight > text.clientHeight && getComputedStyle(text).webkitLineClamp === '2'
            && button.width === 44 && button.height === 44 && button.right <= composer.right
            && document.querySelector('.cancel-reply svg').getBoundingClientRect().width === 24
            && composer.width === document.querySelector('.chat-composer').scrollWidth;
        })()`), true, 'two-line clamp cannot push the cancel button out of view')
        await writeFile(path.join(root, `tmp/browser-failures/reply-text-${width}-${theme}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, session)).data, 'base64'))
        offline = true
        await startReply(`document.querySelector('[data-message-id="${id}"] .chat-bubble')`, 'Today\nhttps://example.com/photo.png #private')
        await browser.until(() => evaluate('document.querySelector(".reply-thumbnail")?.naturalWidth > 0'), 'cached reply thumbnail offline')
        assert.equal(await evaluate(`(() => {
          const image = document.querySelector('.reply-thumbnail').getBoundingClientRect();
          const text = document.querySelector('.reply-text').getBoundingClientRect();
          return document.querySelectorAll('.reply-thumbnail').length === 1 && image.width === 44 && image.height === 44
            && image.right < text.left && Math.abs(text.top - image.top) < 1;
        })()`), true, 'single thumbnail spans two lines with text aligned to its top')
        await writeFile(path.join(root, `tmp/browser-failures/reply-media-${width}-${theme}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, session)).data, 'base64'))
        await evaluate('document.querySelector(".quote-thumbnail").closest(".message-quote").scrollIntoView({block:"center"})')
        await writeFile(path.join(root, `tmp/browser-failures/posted-reply-${width}-${theme}.png`), Buffer.from((await browser.send('Page.captureScreenshot', { format: 'png' }, session)).data, 'base64'))
        await evaluate('document.querySelector(".cancel-reply").focus(); document.querySelector(".cancel-reply").click()')
        await browser.until(() => evaluate('!document.querySelector(".composer-reply")'), 'reply thumbnail removed on cancel')
        offline = false
      }
    }
    await checkScrollScenarios({ browser, evaluate, addNote, media })
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
