import { compile } from './build-options.js'
import { publishBuild } from './publish.js'

const channel = process.argv[2]
if (!['draft', 'main'].includes(channel) || process.argv.length !== 3) throw new Error('Usage: node bin/upload.js draft|main')
const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => controller.abort())
try {
  await publishBuild(await compile({ development: channel === 'draft' }), { channel, signal: controller.signal })
} catch (error) {
  if (!controller.signal.aborted) console.error(error)
  process.exitCode = 1
}
