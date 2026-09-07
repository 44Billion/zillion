import { isValidEvent } from 'libp2r2p/event'
import { isOnline } from 'libp2r2p/network'
import { getLatestEventsByPubkey, relayPool } from 'libp2r2p/relay'

// Profile normalization is specific to the avatar's presentation contract.
export function eventToProfile (event) {
  if (event?.kind !== 0 || !isValidEvent(event)) return null
  let content
  try { content = JSON.parse(event.content) } catch { return null }
  if (!content || typeof content !== 'object' || Array.isArray(content)) return null
  return { ...content, meta: { events: [event] } }
}

// Preserve NIP-01's newest event ordering, including its lowest-id tie breaker.
export function selectPreferredProfile (cached, fresh) {
  if (!cached) return fresh || null
  if (!fresh) return cached
  const a = cached.meta?.events?.find(event => event.kind === 0)
  const b = fresh.meta?.events?.find(event => event.kind === 0)
  if (!a) return fresh
  if (!b) return cached
  return b.created_at > a.created_at || (b.created_at === a.created_at && b.id <= a.id) ? fresh : cached
}

// Local reads never wait for connectivity or a relay request.
export async function getProfile (pubkey, { eventStore = globalThis.window?.napp?.eventStore } = {}) {
  if (!/^[0-9a-f]{64}$/.test(pubkey || '') || !eventStore) return null
  const { results = [] } = await eventStore.query({ kinds: [0], authors: [pubkey], limit: 1 })
  return results.filter(event => event.pubkey === pubkey).map(eventToProfile).reduce(selectPreferredProfile, null)
}

// Refresh signed profile events independently of the local read and rendered fallback.
export async function refreshProfile (pubkey, {
  signal,
  eventStore = globalThis.window?.napp?.eventStore,
  checkOnline = isOnline,
  queryLatest = getLatestEventsByPubkey
} = {}) {
  if (!/^[0-9a-f]{64}$/.test(pubkey || '') || !await checkOnline({ signal })) return null
  const requestSignal = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])])
  const getEvents = (filter, relays, options = {}) => {
    requestSignal.throwIfAborted()
    return relayPool.getEvents(filter, relays, { ...options, signal: requestSignal })
  }
  const { byPubkey } = await queryLatest([pubkey], {
    kinds: [0], _getEvents: getEvents, relayListOptions: { _getEvents: getEvents }
  })
  requestSignal.throwIfAborted()
  const event = byPubkey[pubkey]
  const profile = event?.pubkey === pubkey ? eventToProfile(event) : null
  if (profile && eventStore) {
    try { await eventStore.add(event) } catch (error) { console.warn('Could not persist profile event', error) }
  }
  return profile
}
