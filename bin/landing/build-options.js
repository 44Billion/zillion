import path from 'node:path'
import { readFile } from 'node:fs/promises'

export const root = path.resolve(import.meta.dirname, '../..')
export const outdir = path.join(root, 'landing/dist')

export function buildOptions ({ development = false } = {}) {
  return {
    absWorkingDir: root,
    entryPoints: ['landing/src/components/app.js', 'landing/src/assets/html/index.html', 'src/assets/media/branding/zillion.icon.png'],
    plugins: [{
      name: 'zillion-logo',
      setup (build) {
        // Preserve the declared icon URL while other PNG imports use hashed URLs.
        build.onLoad({ filter: /\.icon\.png$/ }, async args => ({
          contents: await readFile(args.path), loader: 'copy', watchFiles: [args.path]
        }))
      }
    }],
    outdir,
    entryNames: '[name]',
    assetNames: 'assets/[name]-[hash]',
    loader: { '.html': 'copy', '.css': 'text', '.webp': 'file', '.png': 'file', '.svg': 'copy' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['edge91', 'firefox89', 'chrome91', 'safari15'],
    minify: !development,
    sourcemap: development,
    logLevel: 'info'
  }
}
