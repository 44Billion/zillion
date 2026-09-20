import { f, useLocation, useMemo, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import { i18n } from '#i18n/index.js'
import { useAccount } from '#hooks/use-account.js'
import { useRoutePage } from '#shared/route-page.js'
import { chatTimeline } from '#helpers/chat-timeline.js'
import { conversationMedia, isVideoControlPointer, mediaSwipe, selectedMediaId } from '#helpers/conversation-media.js'
import { getSvgAvatar, isValidAvatarPicture } from '#helpers/avatar.js'
import { profileDetails } from '#helpers/profile-presentation.js'
import people from '#views/contacts/fixtures/people.json'
import portraits from '#views/home/fixtures/portraits.js'
import { getMessages } from '#views/chat/fixtures/index.js'
import '#shared/icons/icon-x.js'
import '#shared/icons/icon-chevron-down.js'
import './item.js'
import { viewerStyles } from './styles.js'

f('z-media-viewer-route', ({ h, props }) => {
  const account = useAccount()
  const page = useRoutePage()
  const location = useLocation()
  const runtime = useMemo(() => ({ pointer: null, animation: null, direction: null }))
  const photo = props.route$().url.pathname.endsWith('/photo')
  const view = useStore({
    stageRef$: null,
    person$ () {
      const id = props.route$().params.contactId
      return id === 'user' ? account.person$() : people.find(person => person.id === id)
    },
    messages$ () {
      if (photo) return []
      const person = this.person$()
      return !person ? [] : person.self ? chatTimeline(account.messages$(), { locale: i18n.getLocale(), references: account.references$() }) : person.saved === false ? [] : getMessages(person)
    },
    items$ () {
      const person = this.person$()
      if (!photo) return conversationMedia(this.messages$(), person?.self ? account.references$() : {})
      if (!person) return []
      const picture = person.self ? person.profile?.picture : portraits[person.avatar]
      const url = isValidAvatarPicture(picture) ? picture : person.pubkey ? `data:image/svg+xml,${encodeURIComponent(getSvgAvatar(person.pubkey))}` : null
      return url ? [{ id: 'photo', type: 'image', url, alt: profileDetails(person).name || t('No name') }] : []
    },
    index$ () {
      if (photo) return this.items$().length ? 0 : -1
      const id = selectedMediaId(props.route$().url.hash)
      return id ? this.items$().findIndex(item => item.id === id) : this.items$().length ? 0 : -1
    },
    item$ () { return this.items$()[this.index$()] },
    close () {
      if (props.route$().state?.fromMediaOrigin) location.back()
      else location.replaceState({}, '', `/${photo ? 'profile' : 'chat'}/${encodeURIComponent(props.route$().params.contactId)}`)
    },
    move (step, axis = 'x') {
      const next = this.index$() + step
      if (photo || this.index$() < 0 || next < 0 || next >= this.items$().length) return
      runtime.direction = { step, axis }
      const route = props.route$()
      location.replaceState(route.state, '', `${route.url.pathname}${route.url.search}#${encodeURIComponent(this.items$()[next].id)}`)
    },
    down (event) {
      if (!event.isPrimary) { runtime.pointer = null; return }
      if (photo || event.button !== 0 || event.target.closest('button') || isVideoControlPointer(event)) return
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
  })
  // Direct URLs can resolve the same private references used by the chat.
  useTask(({ track }) => {
    const [active, messages, self] = track(() => [page.isActive$(), view.messages$(), view.person$()?.self])
    if (!active || !self || photo) return
    for (const message of messages) {
      for (const reference of message.references ?? []) {
        if (!account.references$()[reference.id]) account.resolveReference?.(reference)
      }
    }
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
    if (!stage || !direction || !active || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    runtime.animation = stage.animate([
      { transform: `translate${direction.axis.toUpperCase()}(${direction.step * 12}%)`, opacity: 0.35 },
      { transform: 'none', opacity: 1 }
    ], { duration: 200, easing: 'cubic-bezier(.2,.7,.3,1)' })
    cleanup(() => { runtime.animation?.cancel(); runtime.animation = null })
  }, { after: 'rendering' })
  const item = view.item$()
  const count = view.items$().length
  return h`<main class="media-viewer" aria-label=${t(photo ? 'Profile photo' : 'Media')}>
    <style>${viewerStyles}</style>
    <header class="viewer-header">
      <button class="viewer-close" type="button" data-route-autofocus aria-label=${t('Close')} onclick=${view.close}><icon-x props=${{ size: '24px', weight: 'regular' }} /></button>
      <div><h1>${t(photo ? 'Profile photo' : 'Media')}</h1><p aria-live="polite" aria-atomic="true">${!photo && item ? t('{{current}} of {{total}}', { current: view.index$() + 1, total: count }) : item?.alt || ''}</p></div>
      <span class="viewer-header-spacer" aria-hidden="true"></span>
    </header>
    <div class="viewer-stage" onpointerdown=${view.down} onpointerup=${view.up} onpointercancel=${() => { runtime.pointer = null }}>
      <div class="viewer-slide" ref=${view.stageRef$}>${item ? h({ key: item.id })`<z-viewer-item props=${{ item$: view.item$, photo, startTime: item.id === props.route$().state?.mediaId ? props.route$().state?.mediaTime : 0 }} />` : h`<p class="viewer-state" role="status">${t('Media unavailable')}</p>`}</div>
      ${!photo && count > 1 ? h`<button class="viewer-previous" type="button" ?disabled=${view.index$() <= 0} aria-label=${t('Previous media')} onclick=${() => view.move(-1)}><icon-chevron-down props=${{ rotate: 90, size: '24px', weight: 'regular' }} /></button><button class="viewer-next" type="button" ?disabled=${view.index$() < 0 || view.index$() >= count - 1} aria-label=${t('Next media')} onclick=${() => view.move(1)}><icon-chevron-down props=${{ rotate: -90, size: '24px', weight: 'regular' }} /></button>` : null}
    </div>
    <footer class="viewer-footer">${item?.caption ? h`<p>${item.caption}</p>` : null}${!photo && item?.time ? h`<time>${item.time}</time>` : null}</footer>
  </main>`
})
