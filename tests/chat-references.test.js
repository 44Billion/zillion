import { test } from 'node:test'
import assert from 'node:assert/strict'
import { finalizeEvent, getEventHash } from 'libp2r2p/event'
import { neventDecode } from 'libp2r2p/nip19'
import { bytesToBase64, base64ToBytes } from 'libp2r2p/base64'
import {
  chatReferenceUri, createChatReferences, decryptPersonalCopy, isResolvableChatReference
} from '#services/chat-references.js'

const secret = new Uint8Array(32).fill(3)
const pubkey = finalizeEvent({ kind: 0, created_at: 1, tags: [], content: '' }, secret).pubkey
const context = `dm:${pubkey}`

// Direct rumors must not carry id/sig/pubkey: the wrapper mirrors them.
function wrapper (event, { provenance = '1', at = event.created_at, wrapperContext = context } = {}) {
  const inner = { ...event }
  delete inner.id
  delete inner.sig
  delete inner.pubkey
  return finalizeEvent({
    kind: 1006,
    created_at: at,
    tags: [['k', String(event.kind)], ['c', wrapperContext], ['v', provenance]],
    content: bytesToBase64(new TextEncoder().encode(JSON.stringify(inner)))
  }, secret)
}

function innerEvent ({ kind = 9, createdAt = 1, content = '', tags = [] } = {}) {
  const inner = { kind, content, tags, created_at: createdAt }
  return { ...inner, pubkey, id: getEventHash({ ...inner, pubkey }) }
}

const signer = {
  obfuscate: async value => value,
  nip44v3: { decrypt: async (owner, kind, scope, content) => base64ToBytes(content).buffer }
}

test('chat reference URIs carry kind and author without relay hints', () => {
  const event = { id: 'a'.repeat(64), pubkey, kind: 1063 }
  const uri = chatReferenceUri(event)
  assert.match(uri, /^nostr:nevent1/)
  const decoded = neventDecode(uri.slice('nostr:'.length))
  assert.deepEqual(decoded, { id: event.id, relays: [], author: pubkey, kind: 1063 })
  assert.equal(isResolvableChatReference({ kind: 9 }), true)
  assert.equal(isResolvableChatReference({ kind: 1063 }), true)
  assert.equal(isResolvableChatReference({ kind: undefined }), true, 'note1 must be looked up to learn its kind')
  assert.equal(isResolvableChatReference({ kind: 1 }), false)
})

test('personal copies decrypt only for their owner, context and provenance', async () => {
  const inner = { kind: 9, created_at: 5, content: 'hi', tags: [] }
  const good = await decryptPersonalCopy(wrapper(inner), { pubkey, signer, encodedContext: context })
  assert.equal(good.content, 'hi')
  assert.equal(good.pubkey, pubkey)
  assert.equal(await decryptPersonalCopy(wrapper(inner, { wrapperContext: 'dm:other' }), { pubkey, signer, encodedContext: context }), null)
  assert.equal(await decryptPersonalCopy(wrapper(inner, { provenance: '2' }), { pubkey, signer, encodedContext: context }), null)
  assert.equal(await decryptPersonalCopy(wrapper({ ...inner, kind: 1063 }, { at: 6 }), { pubkey, signer, encodedContext: context }), null)
})

test('references resolve from pending locals, then the store, and cache the result', async () => {
  const file = innerEvent({ kind: 1063, createdAt: 9, content: 'caption' })
  const queries = []
  const resolved = []
  const eventStore = {
    async query (filter) {
      queries.push(filter)
      if (filter['#o']) return { results: [wrapper(file)] }
      return { results: [] }
    }
  }
  const references = createChatReferences({ pubkey, eventStore, signer, context, onResolved: (id, event) => resolved.push([id, event.kind]) })
  const local = innerEvent({ createdAt: 10, content: 'local' })
  references.locals.set(local.id, local)
  assert.equal(references.resolve(local.id).id, local.id, 'pending outbox events resolve synchronously')
  assert.equal(references.resolve(file.id), null, 'first lookup is asynchronous')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(queries[0]['#o'], [file.id])
  assert.deepEqual(queries[0]['#k'], undefined)
  assert.equal(queries[0]['#c'][0], context)
  // Pending locals notify immediately (the reply quote/attachment needs a
  // re-render), then the store result lands.
  assert.deepEqual(resolved, [[local.id, 9], [file.id, 1063]])
  assert.equal(references.resolve(file.id)?.content, 'caption', 'second lookup comes from the cache')
  assert.equal(queries.length, 1, 'cache hits do not query again')
})

test('the attachment catalog reads inner kind 1063 copies newest first', async () => {
  const older = innerEvent({ kind: 1063, createdAt: 1, content: 'older' })
  const newer = innerEvent({ kind: 1063, createdAt: 2, content: 'newer' })
  const other = innerEvent({ createdAt: 3, content: 'chat' })
  const queries = []
  const eventStore = {
    async query (filter) {
      queries.push(filter)
      return { results: [wrapper(older), wrapper(newer), wrapper(other)].filter(wrapper => !filter['#k'] || filter['#k'].includes(wrapper.tags.find(tag => tag[0] === 'k')[1])) }
    }
  }
  const references = createChatReferences({ pubkey, eventStore, signer, context })
  const files = await references.readFiles()
  assert.deepEqual(files.map(event => event.content), ['newer', 'older'])
  // The wrapper's plaintext `k` tag is indexed, so the kind filter runs in the
  // store and only the matching wrappers reach decryption.
  assert.deepEqual(queries[0]['#k'], ['1063'])
  assert.deepEqual(queries[0]['#c'], [context])
})

test('a missing reference is retried once its copy can exist', async () => {
  const eventStore = { query: async () => ({ results: [] }) }
  const resolved = []
  const references = createChatReferences({ pubkey, eventStore, signer, context, onResolved: (id, event) => resolved.push([id, event.content]) })
  const file = innerEvent({ kind: 1063, createdAt: 4, content: 'late caption' })
  references.resolve(file.id)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(references.resolve(file.id), null, 'the miss is cached')
  eventStore.query = async filter => ({ results: filter['#o'] ? [wrapper(file)] : [] })
  assert.equal(references.retryMisses(), 0, 'restarted lookups are asynchronous')
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.deepEqual(resolved, [[file.id, 'late caption']])
  assert.equal(references.resolve(file.id)?.content, 'late caption', 'the later result replaces the miss')
})

test('catalog root lookups use the r mirror and validate the decrypted root and context', async () => {
  const root = 'a'.repeat(64)
  const file = innerEvent({ kind: 1063, tags: [['r', root]] })
  const queries = []
  const scopes = []
  const references = createChatReferences({
    pubkey, context: '',
    signer: { ...signer, obfuscate: async (...args) => { scopes.push(args); return args[0] } },
    eventStore: {
      query: async filter => {
        queries.push(filter)
        return { results: [wrapper(file), wrapper(file, { wrapperContext: '' }), wrapper(innerEvent({ kind: 1063 }), { wrapperContext: '' })] }
      }
    }
  })
  assert.deepEqual((await references.readFiles({ root, limit: 1 })).map(event => event.id), [file.id])
  assert.deepEqual(queries[0]['#c'], [''])
  assert.deepEqual(queries[0]['#o'], [root])
  assert.equal(queries[0].limit, 1)
  assert.ok(scopes.some(args => JSON.stringify(args) === JSON.stringify([root, '1006', '#r'])))
})

test('deleting a reference invalidates pending lookups before they can restore cached metadata', async () => {
  const file = innerEvent({ kind: 1063, content: 'Deleted' })
  const queried = Promise.withResolvers()
  const resolved = []
  const references = createChatReferences({
    pubkey, signer, context,
    eventStore: { query: () => queried.promise },
    onResolved: (id, event) => resolved.push([id, event])
  })
  references.resolve(file.id)
  references.remove([file.id])
  queried.resolve({ results: [wrapper(file)] })
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(references.resolve(file.id), null)
  assert.deepEqual(resolved, [[file.id, null]])
})

test('catalog context derivation retries after unlocking the signer', async () => {
  let locked = true
  const file = innerEvent({ kind: 1063 })
  const references = createChatReferences({
    pubkey, context: '',
    signer: { ...signer, obfuscate: async value => { if (locked) throw new Error('LOCKED'); return value } },
    eventStore: { query: async () => ({ results: [wrapper(file, { wrapperContext: '' })] }) }
  })
  await assert.rejects(references.readFiles(), /LOCKED/)
  locked = false
  assert.deepEqual((await references.readFiles()).map(event => event.id), [file.id])
})
