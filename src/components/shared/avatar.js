import { f, useMemo, useSignal, useStore, useTask } from '#f'
import '#f/components/f-svg.js'
import {
  getAvatarImageLoadStatus,
  getSvgAvatar,
  isCacheableAvatarProfile,
  isDataAvatarPicture,
  isKnownAvatarProfile,
  isValidAvatarPicture
} from '#helpers/avatar.js'
import '#shared/icons/icon-user-circle.js'
import { cssVars } from '#assets/styles/theme.js'
import { selectPreferredProfile } from '#helpers/nostr/queries.js'
import { observeProfile } from '#services/profiles.js'
import { onOnline } from 'libp2r2p/network'
import avatarCache from '#services/avatar-cache.js'
import { createAvatarPresentation } from '#services/avatar-presentation.js'
import { abortable } from '#helpers/media-dimensions.js'

const AVATAR_PICTURE_TIMEOUT_MS = 15000

// Each preparation attempt owns its DOM image and decode callbacks. Mounting a
// keyed child keeps ref setup and post-render checks inside the image lifecycle.
f('z-avatar-candidate', ({ h, props }) => {
  const store = useStore(() => ({ imageElement$: null }))
  // A candidate stays invisible until the actual DOM image has decoded. Cached
  // data URLs also need this check; their source alone does not prove readiness.
  useTask(({ track, cleanup }) => {
    const image = track(() => store.imageElement$())
    const candidate = props.candidate
    if (!image) return
    const controller = new AbortController()
    const fail = () => {
      if (controller.signal.aborted || image.getAttribute('src') !== candidate.src) return
      props.reject(candidate)
      controller.abort()
      cleanupImage()
    }
    const loaded = async () => {
      if (controller.signal.aborted || image.getAttribute('src') !== candidate.src) return
      try {
        await abortable(image.decode(), controller.signal)
        if (!controller.signal.aborted && getAvatarImageLoadStatus(image, candidate.src) === 'loaded') {
          props.present(candidate)
          cleanupImage()
        }
      } catch { fail() }
    }
    const timer = setTimeout(fail, AVATAR_PICTURE_TIMEOUT_MS)
    const cleanupImage = () => {
      clearTimeout(timer)
      image.removeEventListener('load', loaded)
      image.removeEventListener('error', fail)
    }
    image.addEventListener('load', loaded)
    image.addEventListener('error', fail)
    const status = getAvatarImageLoadStatus(image, candidate.src)
    if (status === 'loaded') loaded()
    else if (status === 'failed') fail()
    cleanup(() => { controller.abort(); cleanupImage() })
  }, { after: 'rendering' })

  return h`<img class='avatar-candidate' ref=${store.imageElement$} src=${props.candidate.src}
    alt='' aria-hidden='true' decoding='async' referrerpolicy='no-referrer'
    style='position: absolute; inset: 0; width: 100%; height: 100%; visibility: hidden;' />`
})

// wrap it with a div setting width/height, border-radius and background-color
f('a-avatar', ({ h, props }) => {
  const fallbackPk$ = useSignal(props.pk)
  const pk$ = props.pk$ ?? fallbackPk$
  const memory$ = useSignal(null)
  const fallbackCache$ = useSignal(props.profileCache ?? {
    get () { return memory$()?.pk === pk$() ? memory$().profile : null },
    set (profile) { memory$({ pk: pk$(), profile }) },
    remove () { memory$(null) }
  })
  const cache$ = props.profileCache$ ?? fallbackCache$
  const forIdentity = profile => {
    const author = profile?.meta?.events?.find(event => event.kind === 0)?.pubkey
    return author && author !== pk$() ? null : profile
  }
  const getCachedProfile = () => forIdentity(cache$()?.get?.()) || null
  const cacheProfile = profile => cache$()?.set?.(profile)
  const removeCachedProfile = () => cache$()?.remove?.()
  const store = useStore(() => ({
    pk$,
    resolvedPicture$: null,
    visual$: { pk: pk$(), initial: !!pk$(), displayed: null },
    profileState$: { pk: pk$(), pending: !!pk$() },
    providedProfile$ () {
      return forIdentity(props.profile$?.() ?? props.profile ?? null)
    },
    cachedProfile$ () {
      return getCachedProfile()
    },
    refreshedProfile$: null,
    profile$ () {
      return selectPreferredProfile(
        selectPreferredProfile(this.cachedProfile$(), this.providedProfile$()),
        this.refreshedProfile$()?.meta?.events?.[0]?.pubkey === this.pk$()
          ? this.refreshedProfile$()
          : null
      )
    },
    profileLoading$ () {
      if (isKnownAvatarProfile(this.profile$())) return false
      const state = this.profileState$()
      return state.pk === this.pk$() ? state.pending : !!this.pk$()
    },
    picture$ () {
      const picture = this.profile$()?.picture
      return isValidAvatarPicture(picture) ? picture : null
    },
    candidate$ () {
      const resolved = this.resolvedPicture$()
      return resolved?.pk === this.pk$() && resolved.url === this.picture$() && resolved.src
        ? resolved
        : null
    },
    initial$ () {
      const visual = this.visual$()
      return visual.pk === this.pk$() ? visual.initial : !!this.pk$()
    },
    displayed$ () {
      const visual = this.visual$()
      return visual.pk === this.pk$() ? visual.displayed : null
    },
    svg$ () {
      const seed = pk$()
      if (!seed) return
      try {
        return getSvgAvatar(seed)
      } catch (error) {
        console.error(`[avatar ${seed}] Failed to generate avatar:`, error)
        return null
      }
    },
    svgStyle$: () => {
      return [
        `svg {
          display: block;
          width: 100%;
          height: 100%;
        }`,
        props.style$?.() || props.style || ''
      ]
    }
  }))

  const presentation = useMemo(() => createAvatarPresentation({ onChange: store.visual$ }))
  useTask(({ track }) => { presentation.start(track(() => pk$())) })
  useTask(({ cleanup }) => cleanup(() => presentation.close()))

  // Local-only consumers observe existing contact work without starting relay IO.
  useTask(({ track, cleanup }) => {
    const pk = track(() => pk$())
    store.refreshedProfile$(null)
    store.profileState$({ pk, pending: !!pk })
    if (!pk) return
    let released = false
    const interest = observeProfile(pk, {
      remote: !props.localOnly,
      onInitialState: ({ pending }) => {
        if (!released) store.profileState$({ pk, pending })
      },
      onProfile: profile => {
        if (released) return
        store.refreshedProfile$(profile)
        const preferred = selectPreferredProfile(getCachedProfile(), profile)
        if (isCacheableAvatarProfile(preferred)) cacheProfile(preferred)
        else removeCachedProfile()
      }
    })
    cleanup(() => { released = true; interest.release() })
  })

  useTask(({ track }) => {
    presentation.update(track(() => ({ pk: pk$(), picture: store.picture$(), pending: store.profileLoading$() })))
  })

  // Cached bytes and HTTP preparation continue after the initial visual deadline.
  useTask(({ track, cleanup }) => {
    const { pk, url } = track(() => ({ pk: pk$(), url: store.picture$() }))
    const controller = new AbortController()
    let pending = false
    const resolve = async () => {
      if (!url || pending || controller.signal.aborted) return
      if (store.visual$().pk === pk && store.displayed$()?.url === url) return
      pending = true
      try {
        const image = await avatarCache.resolveImage(url, { signal: controller.signal })
        if (!controller.signal.aborted) {
          store.resolvedPicture$({ pk, url, src: image?.source ?? null, id: (store.resolvedPicture$()?.id ?? 0) + 1 })
          if (!image) presentation.reject({ pk, url })
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          presentation.reject({ pk, url })
          console.warn('Could not prepare avatar picture', error)
        }
      } finally { pending = false }
    }
    const stop = url && !isDataAvatarPicture(url) ? onOnline(resolve) : () => {}
    resolve()
    cleanup(() => { controller.abort(); stop() })
  })

  const displayed = store.displayed$()
  const candidate = store.candidate$()
  const initial = store.initial$()
  const fallback = !store.pk$() || !store.svg$()
    ? h`<icon-user-circle props=${{ weight: 'regular', ...props, style$: store.svgStyle$ }} />`
    : h`<f-svg props=${{ ...props, style$: store.svgStyle$, svg: store.svg$() }} />`
  return h`<span class='avatar-presentation' data-avatar-state=${initial ? 'loading' : displayed ? 'photo' : 'fallback'} style=${`
    display: block;
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
  `}>
    <style>${`
      @keyframes zAvatarBackgroundPulse { 50% { opacity: .5; } }
      a-avatar .animate-background {
        animation: zAvatarBackgroundPulse 2s cubic-bezier(.4,0,.6,1) infinite;
        background-color: ${cssVars.colors.bgAvatarLoading};
        position: absolute;
        inset: 0;
      }
    `}</style>
    <span class='animate-background' aria-hidden='true' style=${`display: ${initial ? 'block' : 'none'};`} />
    <span class='avatar-fallback' style=${`display: ${!initial && !displayed ? 'block' : 'none'}; width: 100%; height: 100%;`}>${fallback}</span>
    <img class='avatar-picture' src=${displayed?.src ?? null}
      alt=${props.alt$?.() ?? props.alt ?? ''} decoding='async' referrerpolicy='no-referrer'
      style=${`display: ${displayed ? 'block' : 'none'}; width: 100%; height: 100%; object-fit: cover;`} />
    ${candidate
      ? [h({ key: candidate.id })`<z-avatar-candidate props=${{
          candidate, present: presentation.present, reject: presentation.reject
        }} />`]
      : []}
  </span>`
})
