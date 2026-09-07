// Build workflow from nappstore, adapted to the initial Zillion shell.
import esbuild from 'esbuild'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'jsonc-parser'

const root = path.resolve(import.meta.dirname, '..')
const isDev = process.env.NODE_ENV === 'development'
const outdir = path.join(root, 'dist/zillion')

// Keeps CSS imports as minified text for component styles.
const textLoaderMinifiedCssPlugin = {
  name: 'text-loader-minified-css',
  setup (build) {
    build.onLoad({ filter: /\.css$/ }, async (args) => {
      const source = await readFile(args.path, 'utf8')
      const css = await esbuild.transform(source, { loader: 'css', minify: true })
      return { loader: 'text', contents: css.code }
    })
  }
}

// Generates metadata consumed by nappup, rejecting invalid JSONC.
async function buildNappJson () {
  const errors = []
  const metadata = parse(await readFile(path.join(root, 'napp.jsonc'), 'utf8'), errors)
  if (errors.length) throw new Error('napp.jsonc inválido')
  const directory = path.join(outdir, '.well-known')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, 'napp.json'), JSON.stringify(metadata, null, 2) + '\n')
}

const options = {
  plugins: [textLoaderMinifiedCssPlugin],
  loader: { '.html': 'copy', '.ico': 'copy', '.svg': 'text', '.webp': 'dataurl' },
  define: {
    IS_DEVELOPMENT: JSON.stringify(isDev),
    IS_PRODUCTION: JSON.stringify(!isDev)
  },
  entryPoints: [
    path.join(root, 'src/components/app.js'),
    path.join(root, 'src/assets/html/index.html')
  ],
  outdir,
  entryNames: '[name]',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: ['edge91', 'firefox89', 'chrome91', 'safari15'],
  minify: !isDev,
  sourcemap: isDev,
  write: !isDev
}

if (isDev) {
  const ctx = await esbuild.context(options)
  await ctx.watch()
  const { hosts, port } = await ctx.serve({ host: '127.0.0.1' })
  console.log(`Zillion: http://${hosts[0]}:${port}`)

  // Disposes of the watcher and server when the process stops.
  const stop = async () => { await ctx.dispose() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
} else {
  await rm(outdir, { recursive: true, force: true })
  await esbuild.build(options)
  await buildNappJson()
  console.log(`Build: ${outdir}`)
}
