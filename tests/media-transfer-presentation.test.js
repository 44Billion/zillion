import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { prepareIrfsFile } from 'libp2r2p/irfs'
import { createMediaTransferPresentation } from '#services/media-transfer-presentation.js'

globalThis.IDBKeyRange = IDBKeyRange
const peer = '22'.repeat(32)
const control = '33'.repeat(32)

async function fixture (size = 51001) {
  const prepared = await prepareIrfsFile(new Uint8Array(size).fill(7))
  const chunks = await Array.fromAsync(prepared.chunks())
  const stored = new Map(chunks.map((chunk, index) => [index, chunk]))
  const parent = { pubkey: control, mode: 'seeder' }
  const states = []
  let network = 0
  let readGate = async () => {}
  let readError
  const messenger = {
    extensions: new Set(), prefix: `presentation:${crypto.randomUUID()}`, _indexedDB: new IDBFactory(),
    userPubkey: '11'.repeat(32), desiredChannels: new Set([control]), channels: new Map([[control, parent]]),
    requireWritableChannel: () => parent, recoverySeeders: () => [peer],
    resolveWatchRelays: async () => { network++; throw new Error('NETWORK_REQUIRED') },
    offlineRecoverySecondsFor: () => 604800
  }
  const options = {
    messenger, resolveChannel: async () => ({ getPublicKey: async () => '44'.repeat(32) }),
    storage: {
      async read (root, index) { await readGate(index); if (readError) throw readError; return stored.get(index) },
      async save () { assert.fail('local checking must not write chunks') }
    }
  }
  let manager = createMediaTransferPresentation(options)
  manager.observe(state => states.push(state))
  return {
    states, stored, chunks, file: { controlChannelPubkey: control, peerPubkey: peer, root: prepared.root, size },
    get manager () { return manager }, network: () => network,
    gate (value) { readGate = value }, fail (error) { readError = error },
    async reopen () { await manager.close(); manager = createMediaTransferPresentation(options); states.length = 0; manager.observe(state => states.push(state)) },
    async close () { await manager.close(); prepared.close() }
  }
}

for (const size of [51001, 1048577]) {
  test(`reopening ${size}-byte complete files checks locally without download states or network`, async () => {
    const f = await fixture(size)
    try {
      for (let launch = 0; launch < 2; launch++) {
        await f.manager.download(f.file)
        assert.equal(f.states.at(-1).status, 'complete')
        assert.ok(f.states.every(state => ['checking', 'complete'].includes(state.status)))
        assert.equal(f.network(), 0)
        await f.reopen()
      }
      await f.manager.download({ ...f.file, size: undefined })
      assert.equal(f.states.at(-1).status, 'complete')
      assert.equal(f.network(), 0)
    } finally { await f.close() }
  })
}

test('slow local verification stays checking; missing bytes expose real progress and retries recheck', async () => {
  const f = await fixture()
  try {
    const entered = Promise.withResolvers()
    const release = Promise.withResolvers()
    f.gate(async () => { entered.resolve(); await release.promise })
    const work = f.manager.download(f.file)
    await entered.promise
    assert.ok(f.states.every(state => state.status === 'checking'))
    const replay = []
    const stop = f.manager.observe(state => replay.push(state.status))
    assert.deepEqual(replay, ['checking'])
    stop(); release.resolve(); await work
    await f.reopen()
    f.stored.delete(1)
    await assert.rejects(f.manager.download(f.file), /NETWORK_REQUIRED/)
    assert.ok(f.states.some(state => state.status === 'downloading' && state.completed === 51000))
    assert.equal(f.states.at(-1).status, 'error')
    assert.equal(f.network(), 1)
    f.stored.set(1, f.chunks[1]); f.states.length = 0
    await f.manager.download(f.file)
    assert.ok(f.states.every(state => ['checking', 'complete'].includes(state.status)))
    assert.equal(f.network(), 1)
  } finally { await f.close() }
})

test('large missing files become actionable and local read errors never become completion', async () => {
  const f = await fixture(1048577)
  try {
    f.stored.delete(1)
    await assert.rejects(f.manager.download(f.file), /FILE_DOWNLOAD_REQUIRES_ACTION/)
    assert.equal(f.states.at(-1).status, 'idle')
    assert.equal(f.network(), 0)
    await f.reopen()
    f.fail(new Error('STORAGE_DENIED'))
    await assert.rejects(f.manager.download(f.file, { manual: true }), /STORAGE_DENIED/)
    assert.equal(f.states.at(-1).status, 'error')
    assert.ok(f.states.every(state => state.status !== 'complete'))
  } finally { await f.close() }
})
