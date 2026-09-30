import assert from 'node:assert/strict'
import { generateSecretKey, getPublicKey } from 'libp2r2p/key'
import { bytesToBase16 } from 'libp2r2p/base16'

export async function checkPrivateChats ({ browser, evaluate, pubkey }) {
  const secret = generateSecretKey(); const peer = getPublicKey(secret)
  const vault = 'http://localhost:4000'
  await browser.evaluate('document.querySelector("#toolbar-active-avatar-button").click()')
  await browser.until(() => browser.evaluate('!!document.querySelector("#add-account-btn")', vault), 'second vault account control')
  await browser.evaluate('document.querySelector("#add-account-btn").click()', vault)
  await browser.evaluate(`document.querySelector('account-add input').value = ${JSON.stringify(bytesToBase16(secret))}; document.querySelector('account-add form').requestSubmit()`, vault)
  await browser.until(() => browser.evaluate(`!!document.querySelector('account-avatar[pubkey="${peer}"]')`, vault), 'second real account')
  // Select the default persona in this disposable launcher profile.
  await browser.evaluate(`(() => {
    const read = key => JSON.parse(localStorage.getItem(key) || 'null');
    const selections = {};
    for (const workspace of read('session_workspaceKeys') || []) {
      const apps = [...read('session_workspaceByKey_' + workspace + '_unpinnedAppIds') || [], ...read('session_workspaceByKey_' + workspace + '_pinnedAppIds') || []];
      selections[workspace] = Object.fromEntries(apps.map(id => [id, '__default__']));
    }
    const key = 'local_appPersonaSelections', newValue = JSON.stringify(selections);
    localStorage.setItem(key, newValue); window.dispatchEvent(new StorageEvent('storage', {key, newValue, storageArea:localStorage}));
  })()`)
  await browser.until(() => evaluate(`window.napp.getPersonaPublicKeys().then(keys => keys.includes('${peer}'))`), 'peer available through persona')
  assert.deepEqual(await evaluate(`window.napp.getSignerState({pubkey:'${peer}'})`), { pubkey: peer, connection: 'connected', access: 'allowed', isLocked: false, isReadOnly: false })
  console.log('Private chats: both real identities authorized')
  await evaluate('installPrivateChatFixture()')
  assert.deepEqual(await evaluate('dmTest.checkTemporaryLeaves()'), { count: 130, otherCount: 130 })
  await evaluate(`dmTest.openPeer('${peer}')`)
  console.log('Private chats: peer listener ready')
  await evaluate(`selfChatAccount.setContact('${peer}', true)`)
  await browser.until(() => evaluate(`selfChatAccount.contacts$().some(contact => contact.pubkey === '${peer}')`), 'persistent contact')
  await evaluate(`selfChatAccount.openConversation('${peer}')`)
  const sent = await evaluate(`selfChatAccount.chatFor('${peer}').send('Private hello')`)
  await browser.until(() => evaluate(`dmTest.messages.some(event => event.id === '${sent}' && event.content === 'Private hello')`), 'encrypted channel received by second account', 60000)
  assert.equal(await evaluate('dmTest.messages[0].pubkey'), pubkey)
  await browser.until(() => evaluate(`Object.values(dmTest.messenger.readState().channels).some(channel => channel.mode === 'seeder' && channel.seeders.includes('${pubkey}') && channel.seederActivity?.['${pubkey}']?.announcedAt > 0)`), 'peer runs as seeder and receives the primary participant seeder announcement', 60000)
  await browser.until(() => evaluate(`Array.fromAsync(dmTest.messenger.seedStorage.iterate()).then(seeds => seeds.some(seed => seed.innerEventId === '${sent}'))`), 'peer retains encrypted recovery data for the received message', 60000)
  await browser.until(() => evaluate(`!selfChatAccount.outbox$().some(entry => entry.id === '${sent}')`), 'initial message publication completes', 20000)
  let reply = sent
  if (process.env.ZILLION_MEDIA_SEEDS_ONLY !== '1') {
    await evaluate('dmTest.holdAcknowledgements = true')
    const delayed = await evaluate(`selfChatAccount.chatFor('${peer}').send('Message with delayed relay acknowledgement')`)
    await browser.until(() => evaluate('dmTest.pendingAcknowledgements() > 0'), 'relay has received a publication and holds its OK', 20000)
    await evaluate('new Promise(resolve => setTimeout(resolve, 3500))')
    assert.equal(await evaluate(`selfChatAccount.outbox$().find(entry => entry.id === '${delayed}')?.status`), 'pending', 'the old three-second cutoff must not mark the pending message as failed')
    await evaluate('dmTest.holdAcknowledgements = false; dmTest.releaseAcknowledgements()')
    await browser.until(() => evaluate(`!selfChatAccount.outbox$().some(entry => entry.id === '${delayed}')`), 'late relay acknowledgement confirms the message', 20000)
    await browser.until(() => evaluate(`dmTest.messages.some(event => event.id === '${delayed}')`), 'peer receives the message sent with a delayed OK', 20000)

    console.log('Private chats: delayed confirmation and temporary leaf isolation verified')
    reply = await evaluate(`dmTest.chat.send('Private reply', '${sent}')`)
    await browser.until(() => evaluate(`selfChatAccount.conversations$()['${peer}']?.messages.some(event => event.id === '${reply}')`), 'peer reply in primary account', 60000)
    assert.equal(await evaluate(`selfChatAccount.conversations$()['${peer}'].messages.find(event => event.id === '${reply}').pubkey`), peer)
    assert.equal(await evaluate('dmTest.messenger.presenceTimers.size'), 1, 'peer keeps its seeder presence publisher active')
    assert.equal(await evaluate('JSON.stringify([...dmTest.events.values()]).includes("Private hello")'), false, 'relay receives encrypted content')
  }
  await evaluate('document.querySelector(".chat-back").click()')
  await browser.until(() => evaluate(`!!document.querySelector('.conversation [data-contact-id="${peer}"]')`), 'real peer row on home')
  await evaluate(`document.querySelector('.conversation [data-contact-id="${peer}"]').click()`)
  await browser.until(() => evaluate(`location.pathname === '/chat/${peer}' && document.querySelector('.route-page[data-active=true] .chat-timeline')?.dataset.historyLoaded === 'true'`), 'real peer chat UI')
  if (process.env.ZILLION_MEDIA_SEEDS_ONLY !== '1') {
    await browser.until(() => evaluate(`!!document.querySelector('[data-message-id="${reply}"]') && !!document.querySelector('[data-message-id="${sent}"]')`), 'peer bubbles rendered')
    assert.equal(await evaluate(`document.querySelector('[data-message-id="${reply}"]').classList.contains('incoming')`), true)
    assert.equal(await evaluate(`document.querySelector('[data-message-id="${sent}"]').classList.contains('outgoing')`), true)
    const fileId = await evaluate(`(async () => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='), value => value.charCodeAt(0));
    const attachment = await dmTest.prepareAttachment(new File([bytes], 'peer.png', {type:'image/png'}));
    return dmTest.chat.send('Peer image', undefined, attachment);
  })()`)
    await browser.until(() => evaluate(`document.querySelector('[data-message-id="${fileId}"] .attachment-frame img')?.naturalWidth === 1`), 'peer attachment bytes and metadata arrive', 60000)
    console.log('Private chats: reply and attachment received')
  }
  if (process.env.ZILLION_MEDIA_SEEDS_ONLY === '1') {
    await evaluate(`void (async () => {
      dmTest.largeStage = 'prepare';
      const attachment = await dmTest.prepareAttachment(new File([new Uint8Array(1048577).fill(31)], 'manual.bin', {type:'application/octet-stream'}));
      const root = attachment.metadata.root;
      dmTest.largeStage = 'derive';
      const channel = await dmTest.signer.withSharedKey('${pubkey}', 'dm:media:' + root).getPublicKey();
      dmTest.largeStage = 'persist';
      const id = await dmTest.chat.send('Manual seed recovery', undefined, attachment);
      dmTest.large = {id, root, channel};
    })().catch(error => { dmTest.largeError = error.message })`)
    await browser.until(() => evaluate('(() => { if (dmTest.largeError) throw new Error(dmTest.largeStage + \': \' + dmTest.largeError); return !!dmTest.large })()'), 'large file prepared and durably accepted', 150000)
    const large = await evaluate('dmTest.large')
    console.log('Private media: file persisted; awaiting upload')
    try {
      await browser.until(() => evaluate(`!!document.querySelector('[data-message-id="${large.id}"] .transfer-control button') && !dmTest.outbox.some(entry => entry.id === '${large.id}')`), 'large file announced with manual download', 240000)
    } catch (error) {
      console.error('Private media publication diagnostics:', await evaluate('({errors:dmTest.errors, outbox:dmTest.outbox.map(({status, error, uploadProgress, chunkIndex}) => ({status, error, uploadProgress, chunkIndex})), events:dmTest.events.size})'))
      throw error
    }
    assert.equal(await evaluate(`window.napp.eventStore.query({kinds:[34601], '#d':[dmTest.chunkId('${large.root}', 0)], limit:1}).then(value => value.results.length)`), 0, 'large original has not entered the recipient store automatically')
    const removed = await evaluate(`(() => { let count = 0; for (const [id,event] of dmTest.events) if (event.pubkey === '${large.channel}') {dmTest.events.delete(id); count++}; return count })()`)
    const storage = await evaluate('dmTest.fileStorage()')
    assert.equal(storage['file-seeds'].count, 0, 'seeder must not persist file ciphertext')
    assert.equal(storage.localAuthorizations, 0, 'grants are persisted through eventStore, not the library catalog')
    assert.ok(storage['file-authorizations'].count > 0)
    assert.equal(storage['file-authorizations'].hasPayload, false)
    assert.ok(storage['file-authorizations'].bytes < 10000, 'catalog stays small beside the 1 MiB file')
    console.log('Private media: payload-free catalog confirmed; requesting local chunks after eviction')
    assert.ok(removed > 0, 'remove every original file envelope from the controlled relay')
    await evaluate(`document.querySelector('[data-message-id="${large.id}"] .transfer-control button').click()`)
    try {
      await browser.until(() => evaluate(`window.napp.eventStore.query({kinds:[34601], '#d':[dmTest.chunkId('${large.root}', 0), dmTest.chunkId('${large.root}', 20)], limit:2}).then(value => value.results.length === 2)`), 'manual download recovers first and last chunks from sender seeds', 240000)
    } catch (error) {
      console.error('Private media recovery diagnostics:', await evaluate(`(async () => ({errors:dmTest.errors, control:document.querySelector('[data-message-id="${large.id}"] .transfer-control')?.textContent, events:dmTest.events.size, storage:await dmTest.fileStorage()}))()`))
      throw error
    }
    await browser.until(() => evaluate(`!document.querySelector('[data-message-id="${large.id}"] .transfer-control')`), 'persisted completion clears the progress control', 60000)
    console.log('Private chats: large file stayed manual and recovered from sender chunks without ciphertext seeds after relay eviction')
    await evaluate('dmTest.close()')
    return
  }

  const forwarded = await evaluate(`(async () => {
    const context = {kind:9, pubkey:'${pubkey}', created_at:Math.floor(Date.now()/1000), tags:[['salt','unverified-context']], content:'Context only'};
    const id = dmTest.getEventHash(context);
    const event = {kind:9, pubkey:'${peer}', created_at:context.created_at, tags:[['q',id,'','${pubkey}']], content:dmTest.chatReferenceUri({...context,id}) + '\\nForwarded context'};
    return dmTest.transport.enqueue({peer:'${pubkey}', event, context:[context]});
  })()`)
  await browser.until(() => evaluate(`!!document.querySelector('[data-message-id="${forwarded}"] .unverified')`), 'owner-attributed hearsay is a labeled quote', 60000)
  assert.equal(await evaluate(`selfChatAccount.conversations$()['${peer}'].messages.some(event => event.content === 'Context only')`), false, 'hearsay never becomes a main bubble')
  await evaluate(`document.querySelector('[data-message-id="${forwarded}"] .unverified').click()`)
  await browser.until(() => evaluate('document.querySelector("z-dialog dialog")?.open && document.querySelector("z-dialog p").textContent.length > 0'), 'unverified explanation dialog')
  assert.match(await evaluate('document.querySelector("z-dialog p").textContent'), /without cryptographic proof/)
  await evaluate('document.querySelector("z-dialog dialog").dispatchEvent(new Event("cancel", {cancelable:true}))')
  await browser.until(() => evaluate('!document.querySelector("z-dialog dialog").open'), 'dialog closes')
  await evaluate('window.signerChanges=[]; window.stopSigner=window.napp.onSignerStateChanged(state => signerChanges.push(state));')
  await browser.evaluate('document.querySelector("vault-lock-button button").click()', vault)
  await browser.until(() => evaluate('selfChatAccount.signerState$()?.isLocked === true && signerChanges.at(-1)?.isLocked === true'), 'live account lock notification')
  await browser.evaluate('document.querySelector("lock-overlay .lock-unlock").click()', vault)
  await browser.until(() => evaluate(`selfChatAccount.signerState$()?.isLocked === false && selfChatAccount.conversations$()['${peer}'].historyState === 'loaded'`), 'unlock resumes retained peer history')
  await evaluate('stopSigner()')
  await evaluate(`selfChatAccount.chatFor('${peer}').deleteMessage('${reply}')`)
  await browser.until(() => evaluate(`!selfChatAccount.conversations$()['${peer}'].messages.some(event => event.id === '${reply}')`), 'delete received message for me')
  assert.equal(await evaluate(`dmTest.messages.some(event => event.id === '${reply}')`), true)
  await evaluate(`selfChatAccount.chatFor('${peer}').deleteMessage('${sent}', {everyone:true})`)
  await browser.until(() => evaluate(`!dmTest.messages.some(event => event.id === '${sent}')`), 'delete own message for everyone', 60000)
  await evaluate(`selfChatAccount.setContact('${peer}', false)`)
  assert.equal(await evaluate(`selfChatAccount.contacts$().some(contact => contact.pubkey === '${peer}')`), false)
  await evaluate(`selfChatAccount.setContact('${peer}', true)`)
  console.log('Private chats: both deletions verified; checking failed-send persistence')
  await evaluate('dmTest.rejectPublication = true')
  const durable = await evaluate(`selfChatAccount.chatFor('${peer}').send('Durable across reload')`)
  await browser.until(() => evaluate(`selfChatAccount.outbox$().some(entry => entry.id === '${durable}' && entry.status === 'error')`), 'remote failure persists a retryable entry', 60000)
  assert.equal(await evaluate(`selfChatAccount.outbox$().find(entry => entry.id === '${durable}').retryable`), true)
  console.log('Private chats: retryable failure persisted; reloading')
  const origin = await evaluate('location.origin')
  await evaluate('dmTest.close()')
  await browser.evaluate(`(() => { const frame = [...document.querySelectorAll('app-window iframe')].find(frame => new URL(frame.src).origin === ${JSON.stringify(origin)}); frame.src = ${JSON.stringify(origin + '/chat/' + peer)}; })()`)
  await browser.until(() => evaluate('typeof window.installPrivateChatFixture === "function" && !!window.selfChatAccount?.signerState$()'), 'app reopened with same account')
  await evaluate('installPrivateChatFixture()')
  await evaluate(`dmTest.openPeer('${peer}')`)
  await browser.until(() => evaluate(`selfChatAccount.contacts$().some(contact => contact.pubkey === '${peer}')`), 'contacts survive reload')
  await evaluate('window.napp.getSignerState().then(state => selfChatAccount.delivery().setState(state))')
  await browser.until(() => evaluate(`dmTest.messages.filter(event => event.id === '${durable}').length === 1 && !selfChatAccount.outbox$().some(entry => entry.id === '${durable}')`), 'durable send resumes once under the original ID', 60000)
  await evaluate(`window.peerStates=[]; window.stopPeer=window.napp.onSignerStateChanged(state => peerStates.push(state), {pubkey:'${peer}'})`)
  await browser.until(() => evaluate('peerStates.length === 1'), 'scoped subscription initial state')
  await browser.evaluate('(() => { const key=\'local_appPersonaSelections\', newValue=\'{}\'; localStorage.setItem(key,newValue); window.dispatchEvent(new StorageEvent(\'storage\',{key,newValue,storageArea:localStorage})); })()')
  await browser.until(() => evaluate('peerStates.at(-1)?.access === "revoked"'), 'persona access revocation is terminal')
  assert.deepEqual(await evaluate('peerStates.at(-1)'), { pubkey: peer, connection: 'unknown', access: 'revoked', isLocked: null, isReadOnly: null })
  await evaluate('stopPeer()')
  await evaluate('dmTest.close()')
  console.log('Private chats: two vault accounts, seeder presence and storage, scoped state, encrypted channel, contacts, reply and both deletions verified')
}
