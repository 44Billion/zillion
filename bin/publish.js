import { spawn } from 'node:child_process'
import { mkdir, open, readFile, stat, unlink } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { root, snapshotBuild } from './build-options.js'

// An empty, newly created lock is still owned while its PID is being written.
export async function acquireUploadLock ({ projectRoot = root, signal } = {}) {
  const filename = path.join(projectRoot, 'tmp/upload.lock')
  await mkdir(path.dirname(filename), { recursive: true })
  while (true) {
    signal?.throwIfAborted()
    try {
      const handle = await open(filename, 'wx')
      try { await handle.writeFile(String(process.pid)) } catch (error) {
        await handle.close()
        await unlink(filename)
        throw error
      }
      return async () => { await handle.close(); await unlink(filename).catch(() => {}) }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const pid = Number(await readFile(filename, 'utf8').catch(() => ''))
      if (Number.isSafeInteger(pid) && pid > 0) {
        try { process.kill(pid, 0) } catch (error) {
          // Automatic reclamation can unlink a lock acquired by another waiter.
          if (error.code === 'ESRCH') throw new Error(`Stale upload lock: ${filename} (PID ${pid}). Remove it before retrying.`)
        }
      } else {
        const info = await stat(filename).catch(() => null)
        if (info && Date.now() - info.mtimeMs > 5000) throw new Error(`Incomplete upload lock: ${filename}. Check for an uploader before removing it.`)
      }
      await delay(100, undefined, { signal })
    }
  }
}

export async function publishBuild (files, { channel = 'draft', signal, projectRoot = root, log = text => process.stdout.write(text) } = {}) {
  if (!['draft', 'main'].includes(channel)) throw new Error('Unsupported publication channel')
  const release = await acquireUploadLock({ projectRoot, signal })
  let snapshot
  try {
    signal?.throwIfAborted()
    snapshot = await snapshotBuild(files, projectRoot)
    const entry = fileURLToPath(new URL('../bin/nappup/index.js', import.meta.resolve('nappup')))
    const child = spawn(process.execPath, [entry, snapshot.directory, '-d', 'zillion', `--${channel}`, '-y'], {
      cwd: projectRoot, env: process.env, stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    let app
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', bytes => {
        const text = bytes.toString()
        log(text)
        output = (output + text).slice(-12000)
        app = output.match(/Visit at https:\/\/44billion\.net\/(\S+)/)?.[1] ?? app
      })
    }
    let killTimer
    const abort = () => {
      child.kill('SIGTERM')
      killTimer = setTimeout(() => child.kill('SIGKILL'), 5000)
    }
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', code => code === 0 ? resolve() : reject(new Error(`nappup exited (${code})`)))
      })
      if (!app) throw new Error('nappup did not report a completed publication')
      if (channel === 'draft') log(`Draft preview: http://localhost:10000/${app}\n`)
      return { app, url: `http://localhost:10000/${app}` }
    } finally { signal?.removeEventListener('abort', abort); clearTimeout(killTimer) }
  } finally {
    try { await snapshot?.dispose() } finally { await release() }
  }
}
