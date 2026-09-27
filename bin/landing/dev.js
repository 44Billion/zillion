import esbuild from 'esbuild'
import { buildOptions, outdir } from './build-options.js'

const controller = new AbortController()
const stop = () => controller.abort()
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop)

let context
try {
  context = await esbuild.context(buildOptions({ development: true }))
  await context.watch()
  await context.serve({ host: '127.0.0.1', port: 4173, servedir: outdir })
  console.log('Landing: http://127.0.0.1:4173 — watching HTML, CSS and JavaScript. Reload the page after changes. Ctrl+C stops the server.')
  await new Promise(resolve => {
    if (controller.signal.aborted) resolve()
    else controller.signal.addEventListener('abort', resolve, { once: true })
  })
} catch (error) {
  if (!controller.signal.aborted) { console.error(error); process.exitCode = 1 }
} finally {
  await context?.dispose()
  for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop)
}
