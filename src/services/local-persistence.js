// Presentation reads only the copied session summary, never native errors.
export function localPersistenceFailures (entries, owner, peer) {
  if (!owner || !peer || owner === peer) return []
  return entries.filter(entry => entry.peer === peer && entry.status === 'saved' && entry.localPersistence?.state === 'failed')
}
