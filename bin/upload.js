import { rm } from 'node:fs/promises'
import path from 'node:path'
import { compile, writeBuild, root } from './build-options.js'
import { acquireUploadLock, runNappup } from './publish.js'

const channel = process.argv[2]
if (!['draft', 'main'].includes(channel) || process.argv.length !== 3) throw new Error('Usage: node bin/upload.js draft|main')
const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort())
try {
  const files = await compile({ development: channel === 'draft' })
  const outdir = path.join(root, 'dist/zillion')
  const release = await acquireUploadLock({ signal: controller.signal })
  try {
    controller.signal.throwIfAborted()
    await rm(outdir, { recursive: true, force: true })
    await writeBuild(files, outdir)
    console.log(`Build: ${outdir}`)
    await runNappup(outdir, { channel, signal: controller.signal })
  } finally {
    await release()
  }
} catch (error) {
  if (!controller.signal.aborted) console.error(error)
  process.exitCode = 1
}
