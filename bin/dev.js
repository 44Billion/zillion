import esbuild from 'esbuild'
import { ensureRuntime } from '../../../44billion/bin/dev-runtime.js'
import { startAdbSession } from '../../../44billion/bin/adb-session.js'
import { buildOptions, root } from './build-options.js'
import { createDraftQueue } from './draft-queue.js'
import { createLocalPublisher } from '../../../44billion/bin/local-app-publisher.js'

const controller = new AbortController()
let runtime
let adb
let context
let publisher
let queue
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort())
try {
  if (process.argv.includes('--adb')) adb = await startAdbSession({ signal: controller.signal })
  runtime = await ensureRuntime({ signal: controller.signal })
  const publishRemotely = process.argv.includes('--publish')
  if (publishRemotely) {
    const { publishBuild } = await import('./publish.js')
    publisher = { publish: files => publishBuild(files, { signal: controller.signal }), close: async () => {} }
  } else publisher = await createLocalPublisher(root, { signal: controller.signal })
  queue = createDraftQueue({ publish: publisher.publish, delayMs: publishRemotely ? 2000 : 250 })
  context = await esbuild.context(buildOptions({
    development: true, onStart: queue.invalidate,
    onEnd: files => { if (files) queue.enqueue(files); else queue.invalidate() }
  }))
  await context.watch()
  console.log(publishRemotely
    ? 'Watching Zillion; successful builds publish to draft after two seconds.'
    : 'Watching Zillion locally; successful builds reach the launcher after 250 ms. Ctrl+C stops owned processes.')
  await Promise.race([
    runtime.closed,
    new Promise(resolve => {
      if (controller.signal.aborted) resolve()
      else controller.signal.addEventListener('abort', resolve, { once: true })
    })
  ])
} catch (error) {
  if (!controller.signal.aborted) { console.error(error); process.exitCode = 1 }
} finally {
  controller.abort()
  await context?.dispose()
  await queue?.close()
  await publisher?.close()
  try { await runtime?.close() } finally { await adb?.close() }
}
