import esbuild from 'esbuild'
import { rm } from 'node:fs/promises'
import { buildOptions, outdir } from './build-options.js'

await rm(outdir, { recursive: true, force: true })
await esbuild.build(buildOptions())
console.log(`Landing build: ${outdir}`)
