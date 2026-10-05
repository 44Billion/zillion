import { getLatestEventsByPubkey, isRetryableRelayFailure, relayPool } from 'libp2r2p/relay'

export const REFRESH_MS = 5 * 60 * 1000
export const RETRY_DELAYS = [1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000, 256000, REFRESH_MS]
const transientStatus = status => ['timeout', 'cutoff', 'closed'].includes(status)

function retryable (error, seen = new Set()) {
  if (!error || seen.has(error)) return false
  seen.add(error)
  if (isRetryableRelayFailure(error) || error.name === 'TimeoutError') return true
  if (error.category || error.name === 'ValidationError' || error.name === 'Nip42AuthenticationError') return false
  if (error.errors?.length) return error.errors.every(child => retryable(child, seen))
  return error.cause ? retryable(error.cause, seen) : false
}

// App-owned read policy. The library owns routing, diagnostics and socket
// cooldowns; this state prevents reissuing a refused or not-yet-due lookup.
export function createRelayRead ({ pubkey, kind, now = Date.now, retryDelays = RETRY_DELAYS, cooldowns = new Map(), queryLatest = getLatestEventsByPubkey, getEvents, timeout = 15000, retryEmpty = false }) {
  const blocked = { discovery: new Set(), events: new Set() }
  const due = { discovery: new Map(), events: new Map() }
  let attempt = 0
  let nextAt = 0
  let discoveryUnavailable
  const exclusions = phase => [...new Set([
    ...blocked[phase],
    ...[...due[phase]].filter(([, time]) => time > now()).map(([relay]) => relay),
    ...[...cooldowns].filter(([, time]) => time > now()).map(([relay]) => relay)
  ])]
  return {
    get nextAt () { return nextAt },
    async query (signal) {
      for (const pending of Object.values(due)) for (const [relay, time] of pending) if (time <= now()) pending.delete(relay)
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new DOMException('Profile lookup timed out', 'TimeoutError')), timeout)
      const combined = AbortSignal.any([signal, controller.signal])
      const requests = []
      const partial = {}
      const collect = event => {
        if (event?.kind !== kind || event.pubkey !== pubkey) return
        const previous = partial[pubkey]
        if (!previous || event.created_at > previous.created_at || (event.created_at === previous.created_at && event.id < previous.id)) partial[pubkey] = event
      }
      // A pool read can receive events before its EOSE or admission deadline.
      // Keep those original events if our overall attempt later times out.
      const readEvents = async (filter, relays, options) => {
        const response = await (getEvents || ((...args) => relayPool.getEvents(...args)))(filter, relays, {
          ...options, callback: item => { if (item.type === 'event') collect(item.event); options.callback?.(item) }
        })
        for (const { event } of response.result || []) collect(event)
        return response
      }
      try {
        const result = await queryLatest([pubkey], {
          kinds: [kind], signal: combined,
          ...(discoveryUnavailable ? { relaysByPubkey: { [pubkey]: discoveryUnavailable } } : {}),
          excludeRelaysByPubkey: { [pubkey]: exclusions('events') },
          relayListOptions: { excludeRelays: exclusions('discovery'), ...(getEvents ? { _getEvents: getEvents } : {}) },
          _getEvents: readEvents,
          onQueryResult: request => requests.push(request)
        })
        return { ...result, requests: result.requests || requests }
      } catch (error) {
        signal.throwIfAborted()
        return { byPubkey: partial, requests, error: controller.signal.aborted ? controller.signal.reason : error }
      } finally { clearTimeout(timer) }
    },
    settle (result, { found = false, online = true } = {}) {
      const time = now()
      const delay = retryDelays[Math.min(attempt, retryDelays.length - 1)] ?? 0
      let transient = false
      let unscoped = Infinity
      const record = (phase, relay, status, error) => {
        const retryAt = error?.retryAt ?? (Number.isFinite(error?.retryAfterMs) && error.retryAfterMs > 0 ? time + error.retryAfterMs : undefined)
        if (Number.isFinite(retryAt)) cooldowns.set(relay, Math.max(cooldowns.get(relay) || 0, Math.min(time + REFRESH_MS, retryAt)))
        const timedOut = result.error?.name === 'TimeoutError' && (error?.message === 'Aborted' || error?.name === 'AbortError')
        const retry = timedOut || (error ? retryable(error) : transientStatus(status))
        if (retry) {
          transient = true
          due[phase].set(relay, Math.max(time + (online ? delay : 0), cooldowns.get(relay) || 0))
        } else if (error || !['eose', 'satisfied'].includes(status)) {
          blocked[phase].add(relay); due[phase].delete(relay)
        } else if (phase === 'events') {
          if (retryEmpty) transient = true
          due.events.set(relay, time + (retryEmpty ? delay : REFRESH_MS))
        } else due.discovery.delete(relay)
      }
      for (const request of result.requests || []) {
        const phase = request.phase === 'discovery' ? 'discovery' : 'events'
        for (const item of request.relays || []) record(phase, item.relay, item.status, item.error)
        for (const item of request.errors || []) {
          if (!request.relays?.some(relay => relay.relay === item.relay)) record(phase, item.relay, 'error', item.reason)
        }
        if (request.error && !request.relays?.some(item => item.error === request.error) && retryable(request.error)) {
          transient = true; unscoped = time + (online ? delay : 0)
        }
        if (phase === 'discovery' && request.error && !request.relays?.length && !request.errors?.length && !retryable(request.error) && result.error?.name !== 'TimeoutError') {
          // A local/unknown discovery failure has no eligible relay to retry.
          // Preserve any routes already known and continue only event reads.
          discoveryUnavailable = result.relaysByPubkey?.[pubkey] || { read: [], write: [] }
        }
      }
      if (retryable(result.error)) { transient = true; unscoped = time + (online ? delay : 0) }
      if (found) { attempt = 0; nextAt = time + REFRESH_MS; due.events.clear(); due.discovery.clear() } else {
        if (transient && online) attempt++
        // Keep absolute deadlines: a new consumer or an online notification
        // must not restart or bypass either backoff or relay retry_after.
        const sharedDeadlines = [...cooldowns].filter(([relay, deadline]) => deadline > time && !due.events.has(relay) && !due.discovery.has(relay)).map(([, deadline]) => deadline)
        nextAt = Math.min(unscoped, ...due.events.values(), ...due.discovery.values(), ...sharedDeadlines)
        if (nextAt < time) nextAt = time
      }
      if (!found && result.error && !retryable(result.error)) nextAt = Infinity
      return nextAt
    }
  }
}
