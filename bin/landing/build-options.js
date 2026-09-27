import path from 'node:path'

export const root = path.resolve(import.meta.dirname, '../..')
export const outdir = path.join(root, 'landing/dist')

export function buildOptions ({ development = false } = {}) {
  return {
    absWorkingDir: root,
    entryPoints: ['landing/src/components/app.js', 'landing/src/assets/html/index.html'],
    outdir,
    entryNames: '[name]',
    loader: { '.html': 'copy', '.css': 'text' },
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: ['edge91', 'firefox89', 'chrome91', 'safari15'],
    minify: !development,
    sourcemap: development,
    logLevel: 'info'
  }
}
