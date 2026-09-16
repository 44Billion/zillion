import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import { buildOptions, root } from '../../bin/build-options.js'
import { launchChrome } from '../../../../44billion/tests/browser/runtime/chrome.js'

test('automatic compression preserves output contracts, animation and cleanup', { timeout: 240000 }, async () => {
  const build = await esbuild.build({ ...buildOptions(), entryPoints: ['tests/browser/fixtures/compression-entry.js'], inject: [], write: false })
  const script = build.outputFiles.find(file => file.path.endsWith('.js')).contents
  const server = createServer((request, response) => { response.setHeader('Content-Type', request.url === '/entry.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/entry.js' ? script : '<input type=file><script type=module src=/entry.js></script>') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://localhost:${server.address().port}`
  let browser
  const results = []
  try {
    browser = await launchChrome(); await browser.navigate(origin)
    const evaluate = script => browser.evaluate(script, origin)
    await browser.until(() => evaluate('typeof compressCase === "function"'), 'compression entry')
    const context = [...browser.contexts.values()].find(context => context.origin === origin && context.auxData?.isDefault)
    const select = async name => {
      const { result } = await browser.send('Runtime.evaluate', { expression: 'document.querySelector("input")', contextId: context.id }, context.sessionId)
      try { await browser.send('DOM.setFileInputFiles', { files: [path.join(root, 'tests/browser/fixtures/media', name)], objectId: result.objectId }, context.sessionId) } finally { await browser.send('Runtime.releaseObject', { objectId: result.objectId }, context.sessionId) }
    }
    for (const alpha of [false, true]) {
      await evaluate(`makeImage(1600, 900, ${alpha})`)
      const result = await evaluate('compressCase({generated:true})'); results.push(result); console.log(JSON.stringify({ ...result, steps: result.steps.filter(step => step.phase === 'fallback') }))
      assert.equal(result.changed, true)
      assert.equal(result.mime, alpha ? 'image/webp' : 'image/jpeg')
      assert.deepEqual([result.image.width, result.image.height], [1280, 720])
      if (alpha) assert.ok(Math.abs(result.image.pixel[3] - 96) <= 1)
      assert.deepEqual(await evaluate('listOutputs()'), [])
    }
    for (const name of ['compression.gif', 'compression.png', 'compression.wav', 'compression.mp4', 'compression-rotated.jpg']) {
      await select(name)
      const result = await evaluate(`compressCase({fidelity:${/gif|png/.test(name)}})`); results.push({ name, ...result }); console.log(JSON.stringify({ ...result, source: name, steps: result.steps.filter(step => step.phase === 'fallback') }))
      assert.equal(result.changed, true, `${name}: ${JSON.stringify(result)}`)
      if (/gif|png/.test(name)) { assert.equal(result.image.frames, 12); assert.ok(result.comparison.colorError < 20, JSON.stringify(result.comparison)); assert.ok(result.comparison.alphaError < 2, JSON.stringify(result.comparison)) }
      if (name.includes('rotated')) { assert.deepEqual([result.image.width, result.image.height], [720, 1280]); assert.equal(result.containsExif, false) }
      assert.deepEqual(await evaluate('listOutputs()'), [])
    }
    for (const name of ['avif-False.avif', 'avif-True.avif', 'webp-False.webp', 'webp-True.webp', 'avc-rotated.mp4', 'avc-sar.mp4', 'vp9-alpha.webm', 'compression-hdr.webm']) {
      await select(name)
      const result = await evaluate('compressCase()'); results.push({ source: name, ...result })
      console.log(JSON.stringify({ source: name, ...result, steps: result.steps?.filter(step => step.phase === 'fallback') }))
      assert.ok(result.changed || result.reason === 'not-smaller' || (name.endsWith('.avif') && result.reason === 'unavailable'), JSON.stringify(result))
      assert.deepEqual(await evaluate('listOutputs()'), [])
    }
    const canceled = await evaluate('compressCase({generated:true,cancel:true})')
    assert.match(canceled.error, /AbortError/)
    await browser.until(() => evaluate('listOutputs().then(names => names.length === 0)'), 'canceled output removed')
    const disabled = await evaluate('compressCase({generated:true,disabled:true})')
    assert.equal(disabled.changed, false); assert.equal(disabled.reason, 'disabled')
    const final = await evaluate('checkFinalBytes()')
    assert.equal(final.size, final.metadata.size); assert.equal(final.width, final.metadata.width); assert.equal(final.height, final.metadata.height)
    assert.equal(final.metadata.mime, 'image/webp'); assert.match(final.metadata.filename, /\.webp$/)
    assert.deepEqual(await evaluate('listOutputs()'), [])
    const denied = await evaluate('compressCase({generated:true,storageFailure:true})')
    assert.equal(denied.changed, false); assert.equal(denied.reason, 'unavailable')
    const writeDenied = await evaluate('compressCase({generated:true,writeFailure:true})')
    assert.equal(writeDenied.changed, false); assert.equal(writeDenied.reason, 'unavailable')
    assert.deepEqual(await evaluate('listOutputs()'), [])
    for (const name of ['compression.wav', 'compression.mp4']) {
      await select(name)
      const canceledMedia = await evaluate('compressCase({cancel:true})')
      assert.match(canceledMedia.error, /AbortError/)
      await browser.until(() => evaluate('listOutputs().then(names => names.length === 0)'), 'canceled codec releases output')
    }
    await select('compression.wav'); await evaluate('makeMultichannel()')
    const multichannel = await evaluate('compressCase({generated:true})')
    assert.equal(multichannel.changed, false); assert.equal(multichannel.reason, 'unavailable')
    assert.ok(multichannel.steps.some(step => step.reason === 'UNSUPPORTED_COMPRESSION_CHANNELS'))
    await evaluate('makeImage(1,1)')
    const tiny = await evaluate('compressCase({generated:true})')
    assert.equal(tiny.changed, false); assert.equal(tiny.reason, 'not-smaller')
    const held = await evaluate('holdOutput()')
    await evaluate('makeOrphan()')
    await evaluate(`new Promise(resolve => { const frame=document.createElement('iframe'); frame.id='second'; frame.onload=resolve; frame.src=${JSON.stringify(origin)}; document.body.append(frame) })`)
    await browser.until(() => evaluate("typeof document.querySelector('#second').contentWindow.holdOutput === 'function'"), 'second tab-equivalent owner')
    const second = await evaluate("document.querySelector('#second').contentWindow.holdOutput()")
    assert.ok((await evaluate('listOutputs()')).includes('artifact-aaaaaaaa'), 'preparing another file does not sweep')
    await evaluate('sweepOutputs()')
    assert.deepEqual((await evaluate('listOutputs()')).filter(name => !name.includes('.crswap')).sort(), [held, second].sort(), 'sweep removes orphan and preserves live other owner')
    await evaluate("document.querySelector('#second').remove()")
    await evaluate('closeOutput()')
    await browser.navigate(origin)
    await browser.until(() => evaluate('typeof holdOutput === "function"'), 'reload for abandoned owner cleanup')
    await evaluate('sweepOutputs()')
    const live = await evaluate('holdOutput()')
    assert.deepEqual((await evaluate('listOutputs()')).filter(name => !name.includes('.crswap')), [live])
    await evaluate('closeOutput()')
    await writeFile('/tmp/zillion-compression-results.json', JSON.stringify(results, null, 2))
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
