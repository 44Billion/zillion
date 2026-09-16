import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startTemporaryOutputMaintenance } from '../../src/services/media-preparation/maintenance.js'
import { sweepTemporaryOutputs } from '../../src/services/media-preparation/temporary-output.js'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
function clock (sweep = async () => ({ status: 'complete', failed: 0 }), visible = true) {
  const page = new EventTarget(); page.visibilityState = visible ? 'visible' : 'hidden'
  let time = 0; let id = 0
  const jobs = new Map(); const calls = []
  const stop = startTemporaryOutputMaintenance({
    document: page, sweep: options => { calls.push({ time, signal: options.signal }); return sweep(options) },
    now: () => time, setTimer: (fn, delay) => { jobs.set(++id, { fn, due: time + delay }); return id }, clearTimer: id => jobs.delete(id)
  })
  return {
    calls, jobs, stop,
    async advance (ms) {
      const target = time + ms
      for (;;) {
        const entry = [...jobs].sort((a, b) => a[1].due - b[1].due).find(([, job]) => job.due <= target)
        if (!entry) break
        jobs.delete(entry[0]); time = entry[1].due; entry[1].fn(); await flush()
      }
      time = target; await flush()
    },
    async visibility (value) { page.visibilityState = value ? 'visible' : 'hidden'; page.dispatchEvent(new Event('visibilitychange')); await flush() }
  }
}

test('maintenance waits two elapsed minutes, resumes visible and repeats without resetting on visibility', async () => {
  const c = clock()
  await c.advance(60000); await c.visibility(false); await c.advance(30000); await c.visibility(true)
  await c.advance(29999); assert.equal(c.calls.length, 0)
  await c.advance(1); assert.equal(c.calls.length, 1)
  await c.advance(1800000); assert.equal(c.calls.length, 2)
  await c.visibility(false); await c.advance(5000); await c.visibility(true); await c.advance(0)
  assert.equal(c.calls.length, 3)
  c.stop(); await c.visibility(false); await c.visibility(true); await c.advance(4000000)
  assert.equal(c.calls.length, 3); assert.equal(c.jobs.size, 0)
  const hidden = clock(undefined, false)
  await hidden.advance(150000); assert.equal(hidden.calls.length, 0)
  await hidden.visibility(true); await hidden.advance(0); assert.equal(hidden.calls[0].time, 150000)
  hidden.stop()
})

test('deletion failures retry at 10s, 1m, 5m then 30m; visibility cannot bypass backoff', async () => {
  let fail = true
  const c = clock(async () => ({ failed: fail ? 1 : 0 }))
  await c.advance(120000)
  for (const delay of [10000, 60000, 300000, 1800000]) {
    const before = c.calls.length
    await c.visibility(false); await c.visibility(true)
    await c.advance(delay - 1); assert.equal(c.calls.length, before)
    await c.advance(1); assert.equal(c.calls.length, before + 1)
  }
  fail = false
  await c.advance(1800000)
  fail = true
  await c.visibility(false); await c.visibility(true); await c.advance(0)
  const before = c.calls.length
  await c.advance(10000); assert.equal(c.calls.length, before + 1, 'success resets retries')
  c.stop()
})

test('hidden retries pause, active runs coalesce, unsupported storage stops, unmount aborts', async () => {
  const c = clock(async () => { throw new Error('storage refused') })
  await c.advance(120000); await c.visibility(false); await c.advance(100000)
  assert.equal(c.calls.length, 1); assert.equal(c.jobs.size, 0)
  await c.visibility(true); await c.advance(0); assert.equal(c.calls.length, 2); c.stop()
  let finish
  const active = clock(() => new Promise(resolve => { finish = resolve }))
  await active.advance(120000)
  await active.visibility(false); await active.visibility(true); await active.advance(1800000)
  assert.equal(active.calls.length, 1)
  active.stop(); assert.equal(active.calls[0].signal.aborted, true)
  finish({ failed: 0 }); await flush(); assert.equal(active.jobs.size, 0)
  const unsupported = clock(async () => ({ status: 'unsupported' }))
  await unsupported.advance(120000); await unsupported.visibility(false); await unsupported.visibility(true); await unsupported.advance(4000000)
  assert.equal(unsupported.calls.length, 1); assert.equal(unsupported.jobs.size, 0)
})

function storageFixture () {
  const files = new Set(['artifact-aaaa', 'artifact-aaaa.crswap', 'artifact-bbbb', 'unrelated'])
  const held = new Set(['zillion-compression-v1:artifact-bbbb'])
  let deny = false; let exists = true; let afterDelete = () => {}
  const locks = {
    async request (name, options, run) {
      assert.equal(options.ifAvailable, true)
      if (held.has(name)) return run(null)
      held.add(name)
      try { return await run({ name }) } finally { held.delete(name) }
    }
  }
  const dir = {
    async * keys () { yield * files }, async removeEntry (name) {
      if (deny) throw new DOMException('refused', 'NotAllowedError')
      files.delete(name); afterDelete()
    }
  }
  const storage = {
    async getDirectory () {
      return {
        async getDirectoryHandle (name, options) {
          assert.equal(name, 'zillion-compression-v1'); assert.equal(options?.create, undefined)
          if (!exists) throw new DOMException('missing', 'NotFoundError')
          return dir
        }
      }
    }
  }
  return { files, held, storage, locks, deny: value => { deny = value }, exists: value => { exists = value }, afterDelete: fn => { afterDelete = fn } }
}

test('sweeps preserve live owners and unknown files; failed deletions can be retried in the same document', async () => {
  const f = storageFixture(); f.deny(true)
  const failed = await sweepTemporaryOutputs(f)
  assert.equal(failed.failed, 2); assert.equal(failed.error.name, 'NotAllowedError')
  f.deny(false)
  const result = await sweepTemporaryOutputs(f)
  assert.equal(result.removed, 2); assert.equal(result.retained, 1); assert.equal(result.failed, 0)
  assert.deepEqual([...f.files], ['artifact-bbbb', 'unrelated'])
  f.held.clear(); assert.equal((await sweepTemporaryOutputs(f)).removed, 1)
  f.exists(false); assert.equal((await sweepTemporaryOutputs(f)).failed, 0)
  assert.equal((await sweepTemporaryOutputs({ storage: null, locks: null })).status, 'unsupported')
})

test('maintenance uses a nonwaiting cross-tab lock, shares in-flight scans and aborts between operations', async () => {
  const f = storageFixture(); f.held.add('zillion-compression-v1:maintenance')
  assert.equal((await sweepTemporaryOutputs(f)).status, 'busy'); assert.equal(f.files.size, 4)
  f.held.delete('zillion-compression-v1:maintenance')
  const controller = new AbortController(); f.afterDelete(() => controller.abort())
  const one = sweepTemporaryOutputs({ ...f, signal: controller.signal })
  assert.equal(sweepTemporaryOutputs(f), one)
  const result = await one
  assert.equal(result.status, 'aborted'); assert.equal(result.removed, 1)
  assert.ok(f.files.has('artifact-aaaa.crswap'))
  const later = await sweepTemporaryOutputs(f); assert.equal(later.removed, 1)
})
