// Seekable bytes for a picked File or a local launcher nfile. Remote media
// belongs to the existing HTTP cache/preview path, not this reader.
export async function mediaSource (input, { signal } = {}) {
  const check = () => signal?.throwIfAborted()
  if (input instanceof Blob) {
    return {
      size: input.size,
      async read (start, end) {
        check()
        const bytes = new Uint8Array(await input.slice(start, end).arrayBuffer())
        check()
        return bytes
      }
    }
  }
  const url = new URL(input)
  if (url.origin !== 'https://nostr.alt' || !/^\/nfile1[\da-z]+$/i.test(url.pathname)) throw new Error('INVALID_LOCAL_FILE')
  url.hash = ''
  const head = await fetch(url, { method: 'HEAD', signal, credentials: 'omit' })
  const length = head.headers.get('content-length')
  const size = Number(length)
  if (!head.ok || !length || !Number.isSafeInteger(size) || size <= 0) throw new Error('FILE_UNAVAILABLE')
  return {
    size,
    async read (start, end) {
      check()
      end = Math.min(end, size)
      if (start >= end) return new Uint8Array()
      const response = await fetch(url, { signal, credentials: 'omit', headers: { Range: `bytes=${start}-${end - 1}` } })
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end - 1}/${size}`) {
        await response.body?.cancel()
        throw new Error('INVALID_FILE_RANGE')
      }
      // Bound reads even if a broken server ignores its own Content-Range.
      const reader = response.body.getReader()
      const bytes = new Uint8Array(end - start)
      let offset = 0
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          if (offset + value.length > bytes.length) throw new Error('INVALID_FILE_RANGE')
          bytes.set(value, offset); offset += value.length
        }
        if (offset !== bytes.length) throw new Error('INVALID_FILE_RANGE')
        return bytes
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
    }
  }
}

export function sourceStream (source, blockSize = 65536) {
  let offset = 0
  return new ReadableStream({
    async pull (controller) {
      if (offset >= source.size) { controller.close(); return }
      try {
        const bytes = await source.read(offset, Math.min(offset + blockSize, source.size))
        if (!bytes.length) throw new Error('TRUNCATED_MEDIA')
        offset += bytes.length
        controller.enqueue(bytes)
      } catch (error) { controller.error(error) }
    }
  }, { highWaterMark: 0 })
}
