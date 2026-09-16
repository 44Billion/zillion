const directoryName = 'zillion-compression-v1'
const lockName = name => `${directoryName}:${name}`
let sweep

async function directory () {
  if (!navigator.storage?.getDirectory || !navigator.locks) throw new Error('COMPRESSION_STORAGE_UNAVAILABLE')
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(directoryName, { create: true })
  // A held lock identifies a live owner in ANY tab. Never sweep its output.
  sweep ||= (async () => {
    for await (const name of dir.keys()) {
      const owner = /^(artifact-[\da-f-]+)(?:\.crswap(?:\.\d+)?)?$/.exec(name)?.[1]
      if (!owner) continue
      await navigator.locks.request(lockName(owner), { ifAvailable: true }, async lock => {
        if (lock) await dir.removeEntry(name).catch(() => {})
      })
    }
  })().catch(error => { sweep = null; throw error })
  await sweep
  return dir
}

export async function createTemporaryOutput (maximumSize, { signal } = {}) {
  signal?.throwIfAborted()
  const dir = await directory()
  const name = `artifact-${crypto.randomUUID()}`
  let release, entered
  const ready = new Promise(resolve => { entered = resolve })
  const lock = navigator.locks.request(lockName(name), () => new Promise(resolve => { release = resolve; entered() }))
  await Promise.race([ready, lock])
  let writable; let handle; let closed = false; let finished = false; let extent = 0; let closing
  let tail = Promise.resolve()
  const close = () => {
    if (closing) return closing
    closed = true
    signal?.removeEventListener('abort', onAbort)
    closing = (async () => {
      await tail.catch(() => {})
      try {
        if (writable && !finished) await writable.abort().catch(() => {})
        await dir.removeEntry(name).catch(error => { if (error.name !== 'NotFoundError') throw error })
      } finally { release(); await lock }
    })()
    // Lifecycle callers can await cleanup; unmount callers cannot leak rejection.
    closing.catch(() => {})
    return closing
  }
  const onAbort = () => { close() }
  try {
    signal?.throwIfAborted()
    handle = await dir.getFileHandle(name, { create: true })
    writable = await handle.createWritable()
    signal?.throwIfAborted()
    signal?.addEventListener('abort', onAbort, { once: true })
    return {
      name,
      write (data, position = extent) {
        const work = tail.then(async () => {
          signal?.throwIfAborted()
          if (closed || finished) throw new Error('COMPRESSION_OUTPUT_CLOSED')
          const size = data.size ?? data.byteLength
          if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(size)) throw new Error('INVALID_COMPRESSION_WRITE')
          if (position + size >= maximumSize) throw new Error('COMPRESSION_NOT_SMALLER')
          await writable.write({ type: 'write', position, data })
          extent = Math.max(extent, position + size)
        })
        tail = work
        return work
      },
      finish () {
        const work = tail.then(async () => {
          signal?.throwIfAborted()
          if (closed || finished) throw new Error('COMPRESSION_OUTPUT_CLOSED')
          await writable.close(); finished = true
          signal?.throwIfAborted()
          return handle.getFile()
        })
        tail = work
        return work
      },
      close
    }
  } catch (error) { await close(); throw error }
}
