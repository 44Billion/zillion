import { f, useLocation, useMemo, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import { i18n } from '#i18n/index.js'
import { useAccount, useConversation } from '#hooks/use-account.js'
import { useSignerRecovery, canRecoverSignerFailure } from '#hooks/use-signer-recovery.js'
import { useRoutePage } from '#shared/route-page.js'
import { createStaticMediaReader } from '#services/conversation-media.js'
import { chatTimeline } from '#helpers/chat-timeline.js'
import { conversationMedia, isVideoControlPointer, mediaSwipe, selectedMediaId } from '#helpers/conversation-media.js'
import { getSvgAvatar, isValidAvatarPicture } from '#helpers/avatar.js'
import { profileDetails } from '#helpers/profile-presentation.js'
import portraits from '#views/home/fixtures/portraits.js'
import { getMessages } from '#views/chat/fixtures/index.js'
import '#shared/icons/icon-x.js'
import '#shared/icons/icon-chevron-down.js'
import './item.js'
import { viewerStyles } from './styles.js'

f('z-media-viewer-route', ({ h, props }) => {
  const identity = useAccount()
  const account = useConversation(() => props.route$().params.contactId, { open: true })
  const page = useRoutePage()
  const location = useLocation()
  const runtime = useMemo(() => ({ pointer: null, animation: null, direction: null, reader: null, request: 0, selected: null, pendingFile: null, sessionKey: null, error: null }))
  const photo = props.route$().url.pathname.endsWith('/photo')
  const view = useStore({
    stageRef$: null,
    person$ () {
      const id = props.route$().params.contactId
      return identity.personFor(id)
    },
    slot0$: null, slot1$: null, slot2$: null,
    slots$ () { return [this.slot0$(), this.slot1$(), this.slot2$()] },
    result$: null,
    busy$: true,
    pendingFile$ () {
      if (photo || this.person$()?.demo) return null
      const id = selectedMediaId(props.route$().url.hash)
      if (!id.startsWith('file:')) return null
      return account.messages$().some(message => message.status === 'pending' && message.tags?.some(tag => tag[0] === 'q' && tag[1] === id.slice(5))) ? id : null
    },
    restart$: 0,
    failed$: false,
    photo$ () {
      const person = this.person$()
      if (!photo || !person) return null
      const picture = person.profile ? person.profile.picture : portraits[person.avatar]
      const url = isValidAvatarPicture(picture) ? picture : person.pubkey ? `data:image/svg+xml,${encodeURIComponent(getSvgAvatar(person.pubkey))}` : null
      return url ? { id: 'photo', type: 'image', url, alt: profileDetails(person).name || t('No name') } : null
    },
    item$ () { return this.result$()?.current },
    apply (result, replace = false) {
      const items = [result.previous, result.current, result.next].filter(Boolean)
      const slots = this.slots$().map(old => items.find(item => item.id === old?.id) ?? null)
      for (const item of items) if (!slots.some(slot => slot?.id === item.id)) slots[slots.indexOf(null)] = item
      slots.forEach((item, slot) => this[`slot${slot}$`](item))
      this.result$(result)
      if (replace && result.current) {
        const route = props.route$()
        runtime.selected = result.current.id
        location.replaceState(route.state, '', `${route.url.pathname}${route.url.search}#${encodeURIComponent(result.current.id)}`)
      }
    },
    async load (operation, replace = false) {
      const request = ++runtime.request
      this.busy$(true); this.failed$(false); runtime.error = null
      try {
        const result = await operation()
        if (request === runtime.request && page.isActive$()) this.apply(result, replace)
      } catch (error) {
        if (request === runtime.request && error.name !== 'AbortError') { runtime.error = error; this.failed$(true) }
      } finally { if (request === runtime.request) this.busy$(false) }
    },
    dispose () {
      runtime.request++
      runtime.reader?.close(); runtime.reader = null; runtime.selected = null; runtime.pendingFile = null
      this.slot0$(null); this.slot1$(null); this.slot2$(null); this.result$(null)
      this.busy$(true); this.failed$(false)
    },
    retry () {
      if (runtime.reader) this.load(() => runtime.reader.open(selectedMediaId(props.route$().url.hash)))
      else this.restart$(value => value + 1)
    },
    close () {
      if (props.route$().state?.fromMediaOrigin) location.back()
      else location.replaceState({}, '', `/${photo ? 'profile' : 'chat'}/${encodeURIComponent(props.route$().params.contactId)}`)
    },
    move (step, axis = 'x') {
      const result = this.result$()
      if (photo || this.busy$() || !(step > 0 ? result?.next : result?.previous)) return
      runtime.direction = { step, axis }
      this.load(() => runtime.reader.move(step), true)
    },
    down (event) {
      if (!event.isPrimary) { runtime.pointer = null; return }
      if (photo || event.button !== 0 || event.target.closest('button, a') || isVideoControlPointer(event)) return
      runtime.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
      event.currentTarget.setPointerCapture(event.pointerId)
    },
    up (event) {
      const pointer = runtime.pointer
      runtime.pointer = null
      if (!pointer || pointer.id !== event.pointerId) return
      const swipe = mediaSwipe(event.clientX - pointer.x, event.clientY - pointer.y)
      if (swipe) { event.preventDefault(); this.move(swipe.step, swipe.axis) }
    }
  }, { shouldCache: false })
  useSignerRecovery(() => { if (view.failed$() && canRecoverSignerFailure(runtime.error)) view.retry() })
  // Capture only loaded URLs once per active session. Never resolve the whole
  // timeline, retain ciphertext, or subscribe this snapshot to message arrivals.
  useTask(({ cleanup }) => cleanup(view.dispose))
  useTask(({ track }) => {
    const [active, contactId, pubkey, ready, portrait] = track(() => [page.isActive$(), props.route$().params.contactId, account.pubkey$(), account.ready$(), view.photo$()])
    const restart = track(() => view.restart$())
    // Hash-only navigation reruns dependencies but must not restart the session.
    const sessionKey = JSON.stringify([active, contactId, pubkey, ready, portrait?.url, portrait?.alt, restart])
    if (sessionKey === runtime.sessionKey) return
    runtime.sessionKey = sessionKey
    view.dispose()
    if (!active) return
    if (photo) {
      view.apply({ current: portrait, total: portrait ? 1 : 0, index: portrait ? 0 : -1 })
      view.busy$(false)
      return
    }
    if (contactId === 'user' && (!pubkey || !ready)) return
    const person = view.person$()
    const messages = person && !person.demo
      ? chatTimeline(account.messages$(), { locale: i18n.getLocale(), references: account.references$() })
      : person && person.saved !== false ? getMessages(person) : []
    let reader
    try {
      reader = person && !person.demo
        ? account.createMediaReader({
          extras: conversationMedia(messages, account.references$(), { urlsOnly: true }),
          onInvalidate: () => { if (runtime.reader === reader) view.load(() => reader.refresh(), true) },
          onError: error => { if (runtime.reader === reader) { runtime.error = error; view.failed$(true) } }
        })
        : createStaticMediaReader(conversationMedia(messages))
    } catch (error) { runtime.error = error; view.failed$(true); view.busy$(false); return }
    runtime.reader = reader
    runtime.selected = selectedMediaId(props.route$().url.hash)
    view.load(() => reader.open(runtime.selected))
  })
  useTask(({ track }) => {
    const id = track(() => selectedMediaId(props.route$().url.hash))
    if (photo || !runtime.reader || id === runtime.selected || !page.isActive$()) return
    runtime.selected = id
    view.load(() => runtime.reader.open(id))
  })
  // A bubble exists before its file is committed. Keep the pending state and
  // re-read once the send settles, including when a live notification was missed.
  useTask(({ track }) => {
    const [pending, active] = track(() => [view.pendingFile$(), page.isActive$()])
    if (!active) return
    const previous = runtime.pendingFile
    runtime.pendingFile = pending
    if (!pending && previous && previous === runtime.selected && runtime.reader) view.load(() => runtime.reader.open(previous))
  })
  useTask(({ track, cleanup }) => {
    if (!track(() => page.isActive$())) return
    const key = event => {
      if (event.key === 'Escape') { event.preventDefault(); view.close(); return }
      if (event.altKey || event.ctrlKey || event.metaKey || event.target.closest?.('video, input, textarea')) return
      const step = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : 0
      if (step && !photo) { event.preventDefault(); view.move(step, ['ArrowUp', 'ArrowDown'].includes(event.key) ? 'y' : 'x') }
    }
    document.addEventListener('keydown', key)
    cleanup(() => { document.removeEventListener('keydown', key); runtime.pointer = null })
  })
  useTask(({ track, cleanup }) => {
    const [stage, , active] = track(() => [view.stageRef$(), view.item$()?.id, page.isActive$()])
    const direction = runtime.direction
    runtime.direction = null
    // This animated layer survives hidden routes. Own its visibility explicitly:
    // Chromium can retain the inherited hidden value on a reused animation layer.
    if (stage) stage.style.visibility = active ? 'visible' : 'hidden'
    if (!stage || !direction || !active || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const animation = stage.animate([
      { transform: `translate${direction.axis.toUpperCase()}(${direction.step * 12}%)`, opacity: 0.35 },
      { transform: 'none', opacity: 1 }
    ], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' })
    runtime.animation = animation
    const stop = () => {
      animation.cancel()
      animation.effect = null
      if (runtime.animation === animation) runtime.animation = null
    }
    // Canceling alone can retain the effect and stale inherited visibility on
    // this reused layer. Detach its target on both completion and cleanup.
    animation.finished.then(stop, () => {})
    cleanup(stop)
  }, { after: 'rendering' })
  const item = view.item$()
  const count = view.result$()?.total ?? 0
  return h`<main class="media-viewer" aria-label=${t(photo ? 'Profile photo' : 'Media')}>
    <style>${viewerStyles}</style>
    <header class="viewer-header">
      <button class="viewer-close" type="button" data-route-autofocus aria-label=${t('Close')} onclick=${view.close}><icon-x props=${{ size: '24px', weight: 'regular' }} /></button>
      <div><h1>${t(photo ? 'Profile photo' : 'Media')}</h1><p aria-live="polite" aria-atomic="true">${!photo && item ? t('{{current}} of {{total}}', { current: view.result$().index + 1, total: count }) : item?.alt || ''}</p></div>
      <span class="viewer-header-spacer" aria-hidden="true"></span>
    </header>
    <div class="viewer-stage" onpointerdown=${view.down} onpointerup=${view.up} onpointercancel=${() => { runtime.pointer = null }}>
      <div class="viewer-slide" ref=${view.stageRef$}>
        ${[0, 1, 2].map(slot => h({ key: slot })`<z-viewer-item props=${{
          item$: view[`slot${slot}$`], selected$: () => view.slots$()[slot]?.id === view.item$()?.id,
          photo, retryMetadata: view.retry, startTime$: () => view.slots$()[slot]?.id === props.route$().state?.mediaId ? props.route$().state?.mediaTime ?? 0 : 0
        }} />`)}
        ${!item || view.failed$() ? h`<div class="viewer-state" role="status"><p>${t(view.busy$() || view.pendingFile$() ? 'Loading media' : 'Media unavailable')}</p>${!view.busy$() && !view.pendingFile$() && (view.failed$() || !photo) ? h`<button type="button" onclick=${view.retry}>${t('Retry')}</button>` : null}</div>` : null}
      </div>
      ${!photo && count > 1 ? h`<button class="viewer-previous" type="button" ?disabled=${view.busy$() || !view.result$()?.previous} aria-label=${t('Previous media')} onclick=${() => view.move(-1)}><icon-chevron-down props=${{ rotate: 90, size: '24px', weight: 'regular' }} /></button><button class="viewer-next" type="button" ?disabled=${view.busy$() || !view.result$()?.next} aria-label=${t('Next media')} onclick=${() => view.move(1)}><icon-chevron-down props=${{ rotate: -90, size: '24px', weight: 'regular' }} /></button>` : null}
    </div>
    <footer class="viewer-footer">${item?.caption ? h`<p>${item.caption}</p>` : null}${!photo && (item?.created_at || item?.time) ? h`<time>${item.created_at ? new Date(item.created_at * 1000).toLocaleTimeString(i18n.getLocale(), { hour: '2-digit', minute: '2-digit' }) : item.time}</time>` : null}</footer>
  </main>`
})
