import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, readFile, open, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'

async function wave (filename, seconds) {
  const file = await open(filename, 'w')
  const block = Buffer.alloc(48000 * 4)
  for (let i = 0; i < 48000; i++) { const value = Math.round(Math.sin(i * Math.PI * 2 * 440 / 48000) * 24000); block.writeInt16LE(value, i * 4); block.writeInt16LE(value, i * 4 + 2) }
  const header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + block.length * seconds, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(48000, 24); header.writeUInt32LE(192000, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(block.length * seconds, 40)
  try { await file.write(header); for (let i = 0; i < seconds; i++) await file.write(block) } finally { await file.close() }
}

test('compression memory plateaus with increasing duration and releases canceled jobs', { timeout: 300000 }, async () => {
  const build = await esbuild.build({ ...buildOptions(), entryPoints: ['tests/browser/fixtures/compression-entry.js'], inject: [], write: false })
  const script = build.outputFiles.find(file => file.path.endsWith('.js')).contents
  const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/entry.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/entry.js' ? script : '<input type=file><script type=module src=/entry.js></script>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://localhost:${server.address().port}`
  const directory = await mkdtemp(path.join(tmpdir(), 'compression-memory-'))
  const group = readFileSync('/proc/self/cgroup', 'utf8').trim().split(':').at(-1)
  const memory = () => Number(readFileSync('/sys/fs/cgroup' + group + '/memory.current', 'utf8'))
  let browser
  const results = []
  try {
    browser = await launchChrome(); await browser.navigate(origin)
    const evaluate = script => browser.evaluate(script, origin)
    await browser.until(() => evaluate('typeof compressCase === "function"'), 'memory entry')
    const context = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault)
    const select = async file => {
      const { result } = await browser.send('Runtime.evaluate', { expression: 'document.querySelector("input")', contextId: context.id }, context.sessionId)
      try { await browser.send('DOM.setFileInputFiles', { files: [file], objectId: result.objectId }, context.sessionId) } finally { await browser.send('Runtime.releaseObject', { objectId: result.objectId }, context.sessionId) }
    }
    const measure = async (name, options = {}) => {
      const baseline = memory(); let peak = baseline
      const monitor = setInterval(() => { peak = Math.max(peak, memory()) }, 10)
      try {
        await evaluate(`window.compressionResult=null; compressCase(${JSON.stringify(options)}).then(result => window.compressionResult=result); undefined`)
        await browser.until(() => evaluate('!!window.compressionResult'), name, 180000)
        const result = await evaluate('window.compressionResult')
        assert.equal(result.changed, true, JSON.stringify(result))
        const row = { name, baselineMiB: Math.round(baseline / 1048576), peakMiB: Math.round(peak / 1048576), addedMiB: Math.round((peak - baseline) / 1048576), size: result.size, original: result.original, elapsed: result.elapsed }
        results.push(row); console.log(JSON.stringify(row)); return row
      } finally { clearInterval(monitor) }
    }
    for (const seconds of [60, 180]) { const file = path.join(directory, `${seconds}.wav`); await wave(file, seconds); await select(file); await measure(`audio-${seconds}`) }
    await select(path.join(root, 'tests/browser/fixtures/media/compression.mp4'))
    for (const cycles of [6, 30]) {
      await evaluate(`repeatVideo(${cycles})`)
      await measure(`video-${cycles * 2}`, { generated: true })
      await evaluate('closeGenerated()')
    }
    assert.ok(results[1].peakMiB < results[0].peakMiB * 1.5 + 64, 'audio must not grow with 3x duration')
    assert.ok(results[3].peakMiB < results[2].peakMiB * 1.5 + 128, 'video must not grow with 5x duration')
    for (const size of [2048, 4096]) { await evaluate(`makeImage(${size},${size})`); await measure(`png-${size}`, { generated: true }) }
    const gif = await readFile(path.join(root, 'tests/browser/fixtures/media/compression.gif'))
    const headerEnd = 13 + ((gif[10] & 128) ? 3 * 2 ** ((gif[10] & 7) + 1) : 0)
    for (const cycles of [2, 24]) {
      const filename = path.join(directory, `animation-${cycles}.gif`); const handle = await open(filename, 'w')
      try { await handle.write(gif.subarray(0, headerEnd)); for (let n = 0; n < cycles; n++) await handle.write(gif.subarray(headerEnd, -1)); await handle.write(Uint8Array.of(59)) } finally { await handle.close() }
      await select(filename); await measure(`animation-${cycles * 12}`)
    }
    const animation = results.filter(row => row.name.startsWith('animation'))
    assert.ok(animation[1].peakMiB < animation[0].peakMiB * 1.5 + 128, 'animation must not retain decoded frames with 12x duration')
    await select(path.join(root, 'tests/browser/fixtures/media/compression.mp4'))
    for (let repeat = 0; repeat < 3; repeat++) await measure(`repeat-video-${repeat}`)
    const repeated = results.filter(row => row.name.startsWith('repeat-video'))
    assert.ok(repeated.at(-1).peakMiB < repeated[0].peakMiB + 128, 'repeated selections must plateau')
    for (let i = 0; i < 3; i++) {
      const canceled = await evaluate('compressCase({generated:true,cancel:true})')
      assert.match(canceled.error, /AbortError/)
      await browser.until(() => evaluate('listOutputs().then(names => names.length === 0)'), 'canceled files cleaned')
    }
    await writeFile('/tmp/zillion-compression-memory.json', JSON.stringify(results, null, 2))
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) }
})
