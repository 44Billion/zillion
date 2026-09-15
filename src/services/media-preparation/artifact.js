// The future compression stage replaces this identity implementation, retaining
// the disposable artifact contract. Preview pixels never become upload bytes.
export function createUploadArtifact (input, { signal } = {}) {
  signal?.throwIfAborted()
  if (!(input instanceof Blob) || !input.size) throw new Error('EMPTY_IRFS_FILE')
  let file = input
  const close = () => { file = null; signal?.removeEventListener('abort', close) }
  signal?.addEventListener('abort', close, { once: true })
  return {
    get file () {
      signal?.throwIfAborted()
      if (!file) throw new Error('MEDIA_ARTIFACT_CLOSED')
      return file
    },
    close
  }
}
