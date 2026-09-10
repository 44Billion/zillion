import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canShareText, shareText } from '../src/helpers/share-text.js'

function environment (t, navigator, document = {}) {
  for (const [name, value] of Object.entries({ navigator, document })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { value, configurable: true })
    t.after(() => {
      if (original) Object.defineProperty(globalThis, name, original)
      else delete globalThis[name]
    })
  }
}

test('native sharing receives only the selected message text', async t => {
  const calls = []
  environment(t, { canShare: () => true, share: async data => calls.push(data) })
  assert.equal(canShareText('hello'), true)
  assert.equal(await shareText('hello'), 'shared')
  assert.deepEqual(calls, [{ text: 'hello' }])
})

test('cancelling native sharing never copies a private message', async t => {
  let copied = false
  environment(t, {
    share: async () => { throw new DOMException('Cancelled', 'AbortError') },
    clipboard: { writeText: async () => { copied = true } }
  })
  assert.equal(await shareText('private'), 'cancelled')
  assert.equal(copied, false)
})

for (const reason of ['missing', 'unsupported', 'policy', 'failed']) {
  test(`clipboard fallback when native sharing is ${reason}`, async t => {
    const copies = []
    let shared = false
    const navigator = {
      share: async () => { shared = true; throw new Error('Share failed') },
      clipboard: { writeText: async text => copies.push(text) }
    }
    if (reason === 'missing') delete navigator.share
    if (reason === 'unsupported') navigator.canShare = () => false
    const document = reason === 'policy' ? { permissionsPolicy: { allowsFeature: () => false } } : {}
    environment(t, navigator, document)
    assert.equal(canShareText('message'), reason === 'failed')
    assert.equal(await shareText('message'), 'copied')
    assert.deepEqual(copies, ['message'])
    assert.equal(shared, reason === 'failed')
  })
}
