import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConversationPrefetch } from '#services/conversation-prefetch.js'

const tick = () => new Promise(resolve => setImmediate(resolve))
function fixture (options = {}) {
  const calls = []
  const released = []
  const opened = new Set()
  const prefetch = createConversationPrefetch({
    isOpened: peer => opened.has(peer), release: peer => released.push(peer), ...options,
    load (peer, signal) {
      const done = Promise.withResolvers()
      signal.addEventListener('abort', () => done.resolve(false), { once: true })
      calls.push({ peer, signal, done })
      return done.promise
    }
  })
  return { prefetch, calls, released, opened }
}

test('visible histories run sequentially, reuse completed work and stop offscreen work', async () => {
  const f = fixture()
  try {
    f.prefetch.setVisible(['a', 'b', 'a'])
    await tick()
    assert.deepEqual(f.calls.map(call => call.peer), ['a'])
    f.calls[0].done.resolve(true)
    await tick()
    assert.deepEqual(f.calls.map(call => call.peer), ['a', 'b'])
    f.prefetch.setVisible(['a', 'c'])
    assert.equal(f.calls[1].signal.aborted, true)
    await tick()
    assert.deepEqual(f.calls.map(call => call.peer), ['a', 'b', 'c'])
    f.calls[2].done.resolve(true)
    await tick()
    f.prefetch.setVisible(['a', 'b'])
    await tick()
    assert.equal(f.calls.at(-1).peer, 'b', 'interrupted history can resume')
    f.prefetch.setVisible([])
    assert.equal(f.calls.at(-1).signal.aborted, true)
  } finally { f.prefetch.close() }
})

test('opening an in-flight chat promotes its work and abandons other candidates', async () => {
  const f = fixture()
  try {
    f.prefetch.setVisible(['a', 'b'])
    await tick()
    f.opened.add('a'); f.prefetch.focus(); f.prefetch.setVisible([])
    assert.equal(f.calls[0].signal.aborted, false)
    f.calls[0].done.resolve(true)
    await tick()
    assert.equal(f.calls.length, 1)
    f.prefetch.setVisible(['a', 'b'])
    await tick()
    assert.equal(f.calls[1].peer, 'b')
  } finally { f.prefetch.close() }
})

test('LRU releases only unvisited offscreen histories; reset allows recovery', async () => {
  const f = fixture({ capacity: 1, isPinned: peer => peer === 'self' })
  try {
    for (const peer of ['self', 'a', 'b']) {
      f.prefetch.setVisible([peer]); await tick()
      f.calls.at(-1).done.resolve(true); await tick()
    }
    assert.deepEqual(f.released, ['a'])
    f.opened.add('b')
    f.prefetch.focus()
    f.prefetch.setVisible(['c']); await tick()
    f.calls.at(-1).done.resolve(true); await tick()
    f.prefetch.reset(); f.prefetch.setVisible(['c']); await tick()
    assert.deepEqual(f.calls.map(call => call.peer), ['self', 'a', 'b', 'c', 'c'])
    assert.deepEqual(f.released, ['a'])
    f.prefetch.close()
    assert.equal(f.calls.at(-1).signal.aborted, true)
    f.prefetch.setVisible(['d']); await tick()
    assert.equal(f.calls.length, 5)
  } finally { f.prefetch.close() }
})

test('a failed speculative read does not spin in a retry loop', async () => {
  const f = fixture()
  try {
    f.prefetch.setVisible(['a', 'b']); await tick()
    f.calls[0].done.reject(new Error('locked')); await tick()
    assert.equal(f.calls[1].peer, 'b')
    f.calls[1].done.resolve(true); await tick()
    f.prefetch.setVisible(['a', 'b']); await tick()
    assert.equal(f.calls.length, 2)
  } finally { f.prefetch.close() }
})

test('all visible histories precede media, and newly visible histories interrupt media', async () => {
  const calls = []
  let media
  const prefetch = createConversationPrefetch({
    isOpened: () => false, release () {},
    load: async peer => { calls.push(`history:${peer}`); return true },
    prepare (peer, signal) {
      calls.push(`media:${peer}`)
      const done = Promise.withResolvers()
      signal.addEventListener('abort', () => done.resolve(), { once: true })
      media = { signal, done }
      return done.promise
    }
  })
  try {
    prefetch.setVisible(['a', 'b']); await tick()
    assert.deepEqual(calls, ['history:a', 'history:b', 'media:a'])
    const first = media
    prefetch.setVisible(['a', 'b', 'c'])
    assert.equal(first.signal.aborted, true)
    await tick()
    assert.deepEqual(calls, ['history:a', 'history:b', 'media:a', 'history:c', 'media:a'])
    media.done.resolve(); await tick()
    assert.equal(calls.at(-1), 'media:b')
    prefetch.setVisible([])
    assert.equal(media.signal.aborted, true)
  } finally { prefetch.close() }
})
