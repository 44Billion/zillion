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
import { observeAvatar } from '#services/avatars.js'
import { useAccount } from '#hooks/use-account.js'
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
          props.present(candidate, image)
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
  const account = useAccount()
  const runtime = useMemo(() => ({ anonymous: crypto.randomUUID(), interest: null }))
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
    canvasElement$: null,
    nativeFailure$: null,
    key$ () { return this.pk$() || `anonymous:${runtime.anonymous}` },
    sharedState$ () { return account.avatarStates$()[this.key$()] },
    visual$ () {
      this.sharedState$()
      return account.avatarSnapshot?.(this.key$()) ?? { initial: !!this.pk$() || !!this.picture$(), displayed: null, candidate: null }
    },
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
    candidate$ () { return this.visual$().candidate },
    initial$ () { return this.visual$().initial },
    displayed$ () { return this.visual$().displayed },
    confirm (candidate, image) {
      this.nativeFailure$(null)
      account.confirmAvatar?.(candidate.pk, candidate, image)
    },
    reject (candidate) {
      if (!isDataAvatarPicture(candidate.src)) this.nativeFailure$({ key: candidate.pk, src: candidate.src })
      account.rejectAvatar?.(candidate.pk, candidate)
    },
    rejectDisplayed (event) {
      const src = this.displayed$()?.src
      if (src && !isDataAvatarPicture(src) && event.currentTarget.getAttribute('src') === src) this.nativeFailure$({ key: this.key$(), src })
    },
    useCanvas$ () {
      const failed = this.nativeFailure$()
      return failed?.key === this.key$() && failed.src === this.displayed$()?.src
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

  const options = () => ({
    url: store.picture$(), pending: store.profileLoading$(),
    version: store.profile$()?.meta?.events?.find(event => event.kind === 0)
  })
  useTask(({ track, cleanup }) => {
    const key = track(() => store.key$())
    runtime.interest = observeAvatar(key, options())
    cleanup(() => { runtime.interest?.release(); runtime.interest = null })
  })
  useTask(({ track }) => { runtime.interest?.update(track(options)) })

  // A cross-origin photo may have decoded without exposing readable bytes.
  // If a new DOM load fails, draw its already loaded pixels without exporting
  // a tainted canvas or claiming that the URL is a persistent offline cache.
  useTask(({ track }) => {
    const { key, canvas, fallback } = track(() => ({ key: store.key$(), canvas: store.canvasElement$(), fallback: store.useCanvas$() }))
    if (!canvas || !fallback) return
    const image = account.avatarDrawable?.(key)
    if (!image?.naturalWidth || !image.naturalHeight) return
    const size = Math.max(1, Math.ceil((canvas.clientWidth || canvas.parentElement.clientWidth || 48) * (devicePixelRatio || 1)))
    canvas.width = size; canvas.height = size
    const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight)
    canvas.getContext('2d').drawImage(image, (size - image.naturalWidth * scale) / 2, (size - image.naturalHeight * scale) / 2, image.naturalWidth * scale, image.naturalHeight * scale)
  }, { after: 'rendering' })

  const displayed = store.displayed$()
  const candidate = store.candidate$()
  const initial = store.initial$()
  const canvas = store.useCanvas$()
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
      alt=${props.alt$?.() ?? props.alt ?? ''} decoding='async' referrerpolicy='no-referrer' onerror=${store.rejectDisplayed}
      style=${`display: ${displayed && !canvas ? 'block' : 'none'}; width: 100%; height: 100%; object-fit: cover;`} />
    <canvas ref=${store.canvasElement$} aria-hidden='true' style=${`display: ${canvas ? 'block' : 'none'}; width: 100%; height: 100%;`} />
    ${candidate
      ? [h({ key: candidate.id })`<z-avatar-candidate props=${{
          candidate, present: store.confirm, reject: store.reject
        }} />`]
      : []}
  </span>`
})
