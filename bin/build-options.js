import esbuild from 'esbuild'
import { readFile, mkdir, writeFile, rm, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'jsonc-parser'

export const root = path.resolve(import.meta.dirname, '..')

// Metadata participates in esbuild's dependency graph without entering app.js.
export function buildOptions ({ development = false, futureFeatures = process.env.ZILLION_FUTURE_FEATURES !== '0', projectRoot = root, onStart = () => {}, onEnd = () => {} } = {}) {
  const outdir = path.join(projectRoot, 'dist/zillion')
  let metadata
  return {
    absWorkingDir: projectRoot,
    plugins: [{
      name: 'zillion-build',
      setup (build) {
        build.onStart(() => { metadata = null; onStart() })
        build.onResolve({ filter: /^zillion:metadata$/ }, () => ({ path: 'metadata', namespace: 'zillion' }))
        build.onLoad({ filter: /.*/, namespace: 'zillion' }, async () => {
          const filename = path.join(projectRoot, 'napp.jsonc')
          const errors = []
          const value = parse(await readFile(filename, 'utf8'), errors)
          if (errors.length || !value || typeof value !== 'object' || Array.isArray(value)) {
            return { errors: [{ text: 'Invalid napp.jsonc' }], watchFiles: [filename] }
          }
          metadata = new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n')
          return { contents: '', loader: 'js', watchFiles: [filename] }
        })
        build.onLoad({ filter: /\.icon\.svg$/ }, async args => ({
          contents: await readFile(args.path), loader: 'copy', watchFiles: [args.path]
        }))
        build.onLoad({ filter: /\.css$/ }, async args => {
          const css = await esbuild.transform(await readFile(args.path, 'utf8'), { loader: 'css', minify: true })
          return { loader: 'text', contents: css.code, watchFiles: [args.path] }
        })
        build.onEnd(async result => {
          if (result.errors.length || !metadata) { await onEnd(null); return }
          const files = result.outputFiles.map(file => ({ name: path.relative(outdir, file.path), bytes: new Uint8Array(file.contents) }))
          files.push({ name: '.well-known/napp.json', bytes: metadata.slice() })
          await onEnd(files)
        })
      }
    }],
    inject: ['zillion:metadata'],
    loader: { '.html': 'copy', '.ico': 'copy', '.svg': 'text', '.webp': 'dataurl', '.jpg': 'dataurl', '.png': 'copy' },
    define: {
      IS_DEVELOPMENT: JSON.stringify(development),
      IS_PRODUCTION: JSON.stringify(!development),
      FUTURE_FEATURES_ENABLED: JSON.stringify(development && futureFeatures)
    },
    entryPoints: ['src/components/app.js', 'src/assets/html/index.html', 'src/assets/media/branding/zillion.icon.svg'],
    outdir, entryNames: '[name]', bundle: true, platform: 'browser', format: 'esm',
    target: ['edge91', 'firefox89', 'chrome91', 'safari15'],
    minify: !development, sourcemap: development, write: false
  }
}

export async function compile (options = {}) {
  let files
  await esbuild.build(buildOptions({ ...options, onEnd: result => { files = result } }))
  return files
}

export async function writeBuild (files, directory) {
  for (const { name, bytes } of files) {
    const filename = path.resolve(directory, name)
    if (!filename.startsWith(path.resolve(directory) + path.sep)) throw new Error('Invalid output path')
    await mkdir(path.dirname(filename), { recursive: true })
    await writeFile(filename, bytes)
  }
}

export async function snapshotBuild (files, projectRoot = root) {
  const temporary = path.join(projectRoot, 'tmp')
  await mkdir(temporary, { recursive: true })
  const directory = await mkdtemp(path.join(temporary, 'build-'))
  const appDirectory = path.join(directory, 'zillion')
  try { await writeBuild(files, appDirectory) } catch (error) { await rm(directory, { recursive: true, force: true }); throw error }
  return { directory: appDirectory, dispose: () => rm(directory, { recursive: true, force: true }) }
}
