import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import esbuild from 'esbuild'
import { setTimeout as delay } from 'node:timers/promises'
import { createDraftQueue } from '../bin/draft-queue.js'
import { buildOptions, compile, snapshotBuild } from '../bin/build-options.js'
import { acquireUploadLock } from '../bin/publish.js'

const flush = () => new Promise(resolve => setImmediate(resolve))

test('draft uploads debounce, serialize, and retain only the latest pending build', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const first = Promise.withResolvers()
  const queue = createDraftQueue({ publish: files => { calls.push(files); if (calls.length === 1) return first.promise } })
  queue.enqueue('a')
  t.mock.timers.tick(1500)
  queue.enqueue('b')
  t.mock.timers.tick(1999)
  await flush()
  assert.deepEqual(calls, [])
  t.mock.timers.tick(1)
  await flush()
  queue.enqueue('c')
  t.mock.timers.tick(2000)
  queue.enqueue('d')
  first.resolve()
  await flush()
  assert.deepEqual(calls, ['b'])
  t.mock.timers.tick(2000)
  await flush()
  assert.deepEqual(calls, ['b', 'd'])
  await queue.close()
})

test('invalid builds cancel queued uploads and upload errors allow later builds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const errors = []
  const calls = []
  const queue = createDraftQueue({
    publish: value => { calls.push(value); if (value === 'fail') throw new Error('offline') },
    onError: error => errors.push(error.message)
  })
  queue.enqueue('invalidated')
  queue.invalidate()
  t.mock.timers.tick(2000)
  await flush()
  assert.deepEqual(calls, [])
  queue.enqueue('fail')
  t.mock.timers.tick(2000)
  await flush()
  queue.enqueue('recovered')
  t.mock.timers.tick(2000)
  await flush()
  assert.deepEqual(calls, ['fail', 'recovered'])
  assert.deepEqual(errors, ['offline'])
  queue.enqueue('stopped')
  await queue.close()
  t.mock.timers.tick(2000)
  await flush()
  assert.equal(calls.length, 2)
})

async function fixture (t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'zillion-build-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(path.join(dir, 'src/components'), { recursive: true })
  await mkdir(path.join(dir, 'src/assets/html'), { recursive: true })
  await mkdir(path.join(dir, 'src/assets/media/branding'), { recursive: true })
  await writeFile(path.join(dir, 'src/assets/media/branding/zillion.icon.svg'), '<svg>icon</svg>')
  await writeFile(path.join(dir, 'src/components/app.js'), 'console.log("first")')
  await writeFile(path.join(dir, 'src/assets/html/index.html'), '<p>first</p>')
  await writeFile(path.join(dir, 'napp.jsonc'), '{"name":[["First"]]}')
  return dir
}

test('watch includes metadata-only changes and recovers from invalid metadata', async t => {
  const dir = await fixture(t)
  await writeFile(path.join(dir, 'src/components/asset.svg'), '<svg>first</svg>')
  await writeFile(path.join(dir, 'src/components/style.css'), 'div { color: red; }')
  await writeFile(path.join(dir, 'src/components/app.js'), 'import css from "./style.css"; import svg from "./asset.svg"; console.log(css, svg)')
  const builds = []
  const ctx = await esbuild.context({ ...buildOptions({ projectRoot: dir, onEnd: files => { builds.push(files) } }), logLevel: 'silent' })
  t.after(() => ctx.dispose())
  await ctx.watch()
  const until = async predicate => {
    const deadline = Date.now() + 5000
    while (!predicate()) { if (Date.now() > deadline) throw new Error('Watch did not rebuild'); await delay(30) }
  }
  await until(() => builds.length === 1)
  const metadata = files => JSON.parse(new TextDecoder().decode(files.find(file => file.name === '.well-known/napp.json').bytes))
  assert.equal(metadata(builds[0]).name[0][0], 'First')
  await writeFile(path.join(dir, 'napp.jsonc'), '{ broken')
  await until(() => builds.at(-1) === null)
  await writeFile(path.join(dir, 'napp.jsonc'), '{"name":[["Second"]]}')
  await until(() => builds.at(-1) && metadata(builds.at(-1)).name[0][0] === 'Second')
  const text = name => new TextDecoder().decode(builds.at(-1).find(file => file.name === name).bytes)
  await writeFile(path.join(dir, 'src/assets/html/index.html'), '<p>updated html</p>')
  await until(() => text('index.html').includes('updated html'))
  await writeFile(path.join(dir, 'src/components/style.css'), 'div { z-index: 42; }')
  await until(() => text('app.js').includes('z-index:42'))
  await writeFile(path.join(dir, 'src/components/asset.svg'), '<svg>second</svg>')
  await until(() => text('app.js').includes('<svg>second</svg>'))
  await writeFile(path.join(dir, 'src/assets/media/branding/zillion.icon.svg'), '<svg>updated icon</svg>')
  await until(() => text('zillion.icon.svg').includes('updated icon'))
  await writeFile(path.join(dir, 'src/components/app.js'), 'syntax error!')
  await until(() => builds.at(-1) === null)
  await writeFile(path.join(dir, 'src/components/app.js'), 'console.log("recovered source")')
  await until(() => builds.at(-1) && text('app.js').includes('recovered source'))
})

test('publication snapshots retain the complete original build while sources change', async t => {
  const dir = await fixture(t)
  const files = await compile({ projectRoot: dir })
  const snapshot = await snapshotBuild(files, dir)
  t.after(snapshot.dispose)
  await writeFile(path.join(dir, 'src/components/app.js'), 'console.log("second")')
  await writeFile(path.join(dir, 'src/assets/html/index.html'), '<p>second</p>')
  await compile({ projectRoot: dir })
  assert.match(await readFile(path.join(snapshot.directory, 'app.js'), 'utf8'), /first/)
  assert.equal(await readFile(path.join(snapshot.directory, 'index.html'), 'utf8'), '<p>first</p>')
})

test('watch and one-shot publication share an abortable project lock', async t => {
  const dir = await fixture(t)
  const release = await acquireUploadLock({ projectRoot: dir })
  const controller = new AbortController()
  const waiting = acquireUploadLock({ projectRoot: dir, signal: controller.signal })
  controller.abort()
  await assert.rejects(waiting, { name: 'AbortError' })
  await release()
  await (await acquireUploadLock({ projectRoot: dir }))()
})

test('published bundles exclude browser fixtures and tests', async () => {
  const files = await compile()
  assert.equal(files.some(file => /test|fixture/i.test(file.name)), false)
  const app = new TextDecoder().decode(files.find(file => file.name === 'app.js').bytes)
  assert.doesNotMatch(app, /zillion:test:|__zillionTest|node:assert|node:test/)
})
