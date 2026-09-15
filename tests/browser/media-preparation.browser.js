import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { readFileSync, createWriteStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { once } from 'node:events'
import path from 'node:path'
import { createDeflate, crc32 } from 'node:zlib'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'

async function largePng (filename, size) {
  const file = createWriteStream(filename)
  const chunk = (type, data) => {
    const name = Buffer.from(type); const length = Buffer.alloc(4); const checksum = Buffer.alloc(4)
    length.writeUInt32BE(data.length); checksum.writeUInt32BE(crc32(data, crc32(name)))
    file.write(length); file.write(name); file.write(data); file.write(checksum)
  }
  file.write(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2
  chunk('IHDR', header)
  const deflater = createDeflate()
  deflater.on('data', data => chunk('IDAT', data))
  const row = Buffer.alloc(size * 3 + 1, 100); row[0] = 0
  for (let y = 0; y < size; y++) if (!deflater.write(row)) await once(deflater, 'drain')
  deflater.end(); await once(deflater, 'end')
  chunk('IEND', Buffer.alloc(0)); file.end(); await once(file, 'close')
}

test('production media preparation covers image variants, video workers, cancellation and large PNGs', { timeout: 240000 }, async () => {
  const options = buildOptions()
  const build = await esbuild.build({ ...options, entryPoints: ['tests/browser/fixtures/media-preparation-entry.js'], inject: [], write: false })
  const script = build.outputFiles.find(file => file.path.endsWith('.js')).contents
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', request.url === '/entry.js' ? 'text/javascript' : 'text/html')
    response.end(request.url === '/entry.js' ? script : '<input type=file><script type=module src=/entry.js></script>')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://localhost:${server.address().port}`
  const directory = await mkdtemp(path.join(tmpdir(), 'zillion-media-'))
  let browser
  try {
    browser = await launchChrome()
    await browser.navigate(origin)
    await browser.until(() => browser.evaluate('typeof runMediaPreview === "function"', origin), 'media entry')
    await browser.evaluate('window.activePreviewWorkers = new Set(); window.previewWorkersCreated = 0; const OriginalWorker = window.Worker; window.Worker = class extends OriginalWorker { constructor(...args) {super(...args); activePreviewWorkers.add(this); previewWorkersCreated++} terminate() {activePreviewWorkers.delete(this); super.terminate()} };', origin)
    const context = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault)
    const select = async filename => {
      const { result } = await browser.send('Runtime.evaluate', { expression: 'document.querySelector("input")', contextId: context.id }, context.sessionId)
      try { await browser.send('DOM.setFileInputFiles', { files: [filename], objectId: result.objectId }, context.sessionId) } finally { await browser.send('Runtime.releaseObject', { objectId: result.objectId }, context.sessionId) }
    }
    const fixtures = path.join(root, 'tests/browser/fixtures/media')
    const results = []
    for (const name of await readdir(fixtures)) {
      if (!/\.(png|jpg|webp|avif|gif|mp4|webm)$/.test(name)) continue
      await select(path.join(fixtures, name))
      const result = await browser.evaluate(`runMediaPreview(${JSON.stringify(name)}).catch(error => ({error:String(error)}))`, origin)
      if (/bad-crc|truncated/.test(name)) {
        assert.ok(result.error, `${name}: corrupted input should fail`)
      } else {
        assert.ok(!result.error, `${name}: ${result.error}`)
        assert.ok(result.thumbnailWidth <= 320 && result.thumbnailHeight <= 320, name)
        assert.ok(result.width > 0 && result.height > 0 && result.hash.length > 0, name)
        if (/orientation-[5-8]/.test(name)) assert.deepEqual([result.width, result.height], [128, 192])
        if (name === 'avc-rotated.mp4') assert.deepEqual([result.width, result.height], [180, 320])
        if (name === 'avc-sar.mp4') assert.deepEqual([result.width, result.height], [640, 180])
        if (name === 'vp9-alpha.webm') assert.equal(result.pixel[3], 63)
        if (/^png-c/.test(name)) assert.ok(result.maximumPixelError <= 2, `${name}: native pixel comparison ${result.maximumPixelError}`)
      }
      assert.equal(await browser.evaluate('activePreviewWorkers.size', origin), 0, `${name}: workers released`)
      results.push({ name, ...result })
    }
    await select(path.join(fixtures, 'avc.mp4'))
    await browser.evaluate('window.savedVideoDecoder = window.VideoDecoder; window.VideoDecoder = undefined', origin)
    const fallback = await browser.evaluate("runMediaPreview('avc-native.mp4')", origin)
    await browser.evaluate('window.VideoDecoder = window.savedVideoDecoder; delete window.savedVideoDecoder', origin)
    assert.equal(fallback.backend, 'native-video')
    assert.deepEqual([fallback.width, fallback.height], [320, 180])
    const group = readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').at(-1)
    const memory = () => Number(readFileSync('/sys/fs/cgroup' + group + '/memory.current', 'utf8'))
    for (const size of [8192, 16384]) {
      const filename = path.join(directory, `${size}.png`)
      await largePng(filename, size); await select(filename)
      const baseline = memory(); let peak = baseline
      const monitor = setInterval(() => { peak = Math.max(peak, memory()) }, 10)
      let result
      try { result = await browser.evaluate(`runMediaPreview('${size}.png')`, origin) } finally { clearInterval(monitor) }
      assert.equal(result.backend, 'png-rows')
      assert.deepEqual([result.width, result.height], [size, size])
      assert.equal(result.thumbnailWidth, 320)
      // Includes Chrome native memory, file cache and allocation overhead.
      assert.ok(peak - baseline < 160 * 1024 * 1024, `PNG ${size}: ${Math.round((peak - baseline) / 1048576)} MiB`)
      console.log(`PNG ${size}: additional ${Math.round((peak - baseline) / 1048576)} MiB`)
      results.push({ ...result, additionalMiB: Math.round((peak - baseline) / 1048576) })
    }
    const cancel = await browser.evaluate('cancelMediaPreview()', origin)
    assert.equal(cancel.canceled, true)
    assert.ok(cancel.elapsed < 1000)
    assert.equal(await browser.evaluate('activePreviewWorkers.size', origin), 0)
    await select(path.join(fixtures, 'png-c2-d8-i1.png'))
    const prepared = await browser.evaluate('checkPreparedBytes()', origin)
    assert.equal(prepared.size, prepared.originalSize)
    assert.equal(prepared.originalWidth, 129)
    assert.equal(await browser.evaluate('activePreviewWorkers.size', origin), 0)
    await writeFile('/tmp/zillion-media-preparation-results.json', JSON.stringify({ results, cancel, prepared }, null, 2))
  } finally {
    await browser?.close()
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(directory, { recursive: true, force: true })
  }
})
