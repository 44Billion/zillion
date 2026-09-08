import { rm } from 'node:fs/promises'
import path from 'node:path'
import { compile, writeBuild, root } from './build-options.js'

const files = await compile()
const outdir = path.join(root, 'dist/zillion')
await rm(outdir, { recursive: true, force: true })
await writeBuild(files, outdir)
console.log(`Build: ${outdir}`)
