import { f, useSignal, useStore, useAsyncComputed, useTask } from '#f'
import '#f/components/f-svg.js'
import {
  getAvatarImageLoadStatus,
  getSvgAvatar,
  isCacheableAvatarProfile,
  isDataAvatarPicture,
  isValidAvatarPicture
} from '#helpers/avatar.js'
import '#shared/icons/icon-user-circle.js'
import { cssVars } from '#assets/styles/theme.js'
import { getProfile, refreshProfile, selectPreferredProfile } from '#helpers/nostr/queries.js'
import { onOnline } from 'libp2r2p/network'
import mediaCache from '#services/media-cache.js'

const AVATAR_PICTURE_TIMEOUT_MS = 15000

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
  const getCachedProfile = () => cache$()?.get?.() || null
  const cacheProfile = profile => cache$()?.set?.(profile)
  const removeCachedProfile = () => cache$()?.remove?.()
  const store = useStore(() => ({
    pk$,
    imageElement$: null,
    loadedPicture$: null,
    resolvedPicture$: null,
    rejectedPicture$: null,
    providedProfile$ () {
      return props.profile$?.() ?? props.profile ?? null
    },
    cachedProfile$ () {
      return getCachedProfile()
    },
    refreshedProfile$: useAsyncComputed(async ({ track, cleanup }) => {
      let cancelled = false
      cleanup(() => { cancelled = true })
      const pk = track(() => pk$())
      const providedProfile = track(() => props.profile$?.() ?? props.profile ?? null)
      if (!pk) return providedProfile

      const queriedProfile = await getProfile(pk).catch(error => {
        console.error(`[avatar ${pk}] Failed to refresh profile:`, error)
        return null
      })
      if (cancelled) return null
      const freshProfile = selectPreferredProfile(providedProfile, queriedProfile)

      const cachedProfile = getCachedProfile()
      const preferredProfile = selectPreferredProfile(cachedProfile, freshProfile)
      if (preferredProfile === freshProfile && isCacheableAvatarProfile(freshProfile)) {
        cacheProfile(freshProfile)
      } else if (preferredProfile === freshProfile && cachedProfile) {
        removeCachedProfile()
      }
      return preferredProfile
    }),
    profile$ () {
      return selectPreferredProfile(
        selectPreferredProfile(this.cachedProfile$(), this.providedProfile$()),
        this.refreshedProfile$()?.meta?.events?.[0]?.pubkey === this.pk$()
          ? this.refreshedProfile$()
          : null
      )
    },
    picture$ () {
      const picture = this.profile$()?.picture
      return isValidAvatarPicture(picture) ? picture : null
    },
    pictureToRender$ () {
      const resolved = this.resolvedPicture$()
      const picture = resolved?.pk === this.pk$() && resolved.url === this.picture$()
        ? resolved.src
        : null
      const rejected = this.rejectedPicture$()
      return picture && !(rejected?.pk === this.pk$() && rejected.picture === picture)
        ? picture
        : null
    },
    isPictureLoaded$ () {
      const picture = this.pictureToRender$()
      if (isDataAvatarPicture(picture)) return true
      const loaded = this.loadedPicture$()
      return !!picture && loaded?.pk === this.pk$() && loaded.picture === picture
    },
    markPictureLoaded (event) {
      const picture = this.pictureToRender$()
      if (!picture || event.currentTarget.getAttribute('src') !== picture) return
      this.loadedPicture$({ pk: this.pk$(), picture })
    },
    failPicture (picture, error) {
      if (!picture || picture !== this.pictureToRender$()) return
      console.error(`[avatar ${this.pk$() || 'unknown'}] Failed to load avatar picture:`, error)
      this.loadedPicture$(null)
      this.rejectedPicture$({ pk: this.pk$(), picture })
    },
    rejectPicture (event) {
      const picture = this.pictureToRender$()
      if (!picture || event.currentTarget.getAttribute('src') !== picture) return
      this.failPicture(picture, new Error(`Avatar picture failed to load: ${picture}`))
    },
    svg$ () {
      const seed = pk$()
      if (!seed) return
      return getSvgAvatar(seed)
    },
    svgStyle$: () => {
      return [
        `svg {
          width: 100%;
          height: 100%;
        }`,
        props.style$?.() || props.style || ''
      ]
    }
  }))

  // Read local profiles immediately and refresh independently after connectivity recovers.
  useTask(({ track, cleanup }) => {
    const pk = track(() => pk$())
    if (!pk) return
    const controller = new AbortController()
    let pending = false
    const refresh = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const profile = await refreshProfile(pk, { signal: controller.signal })
        if (!controller.signal.aborted && profile) {
          cacheProfile(selectPreferredProfile(getCachedProfile(), profile))
        }
      } catch (error) {
        if (!controller.signal.aborted) console.warn('Profile refresh failed', error)
      } finally { pending = false }
    }
    const stop = onOnline(refresh)
    refresh()
    cleanup(() => { controller.abort(); stop() })
  })

  // Resolve cached bytes before attempting HTTP; stale tasks cannot replace a new avatar.
  useTask(({ track, cleanup }) => {
    const { pk, url } = track(() => ({ pk: pk$(), url: store.picture$() }))
    const controller = new AbortController()
    let pending = false
    const resolve = async () => {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const src = await mediaCache.resolveImage(url, { signal: controller.signal })
        if (!controller.signal.aborted) {
          store.rejectedPicture$(null)
          store.resolvedPicture$({ pk, url, src })
        }
      } finally { pending = false }
    }
    const stop = url && !isDataAvatarPicture(url) ? onOnline(resolve) : () => {}
    resolve()
    cleanup(() => { controller.abort(); stop() })
  })

  useTask(({ track, cleanup }) => {
    const { picture, isLoaded } = track(() => ({
      picture: store.pictureToRender$(),
      isLoaded: store.isPictureLoaded$()
    }))
    if (!picture || isLoaded) return

    const timeoutId = setTimeout(() => {
      const error = new Error(`Avatar picture timed out after ${AVATAR_PICTURE_TIMEOUT_MS}ms: ${picture}`)
      error.name = 'TimeoutError'
      store.failPicture(picture, error)
    }, AVATAR_PICTURE_TIMEOUT_MS)
    cleanup(() => clearTimeout(timeoutId))
  })

  useTask(({ track }) => {
    const { picture, isLoaded, image } = track(() => ({
      picture: store.pictureToRender$(),
      isLoaded: store.isPictureLoaded$(),
      image: store.imageElement$()
    }))
    if (!picture || isLoaded) return

    const status = getAvatarImageLoadStatus(image, picture)
    if (status === 'loaded') store.markPictureLoaded({ currentTarget: image })
    else if (status === 'failed') store.rejectPicture({ currentTarget: image })
  }, { after: 'rendering' })

  if (!store.profile$() && store.refreshedProfile$.promise$().isLoading) {
    return h`<div
      style=${`
        width: 100%;
        height: 100%;
        border-style: solid;
        border-width: 0;
        overflow: hidden;
      `}
    >
      <style>${`
          @keyframes zAvatarBackgroundPulse {
            50% {
              opacity: .5;
            }
          }
        a-avatar .animate-background {
          animation: zAvatarBackgroundPulse 2s cubic-bezier(.4,0,.6,1) infinite;
          background-color: ${cssVars.colors.bgAvatarLoading};
          position: relative;
          height: 100%;
        }
      `}</style>
      <div class='animate-background' />
    </div>`
  }

  const picture = store.pictureToRender$()
  if (picture) {
    const isPictureLoaded = store.isPictureLoaded$()
    return h`
      <style>
        @keyframes zAvatarImagePulse {
          0% { opacity: 0.1; }
          50% { opacity: 0.5; }
          100% { opacity: 0.1; }
        }
      </style>
      <span style=${`
        display: block;
        position: relative;
        width: 100%;
        height: 100%;
        overflow: hidden;
      `}>
        <span
          aria-hidden='true'
          style=${`
            position: absolute;
            inset: 0;
            background-color: ${cssVars.colors.bgAvatarLoading};
            visibility: ${isPictureLoaded ? 'hidden' : 'inherit'};
            animation: ${isPictureLoaded ? 'none' : 'zAvatarImagePulse 2s cubic-bezier(.4,0,.6,1) infinite'};
          `}
        />
        <img
          ref=${store.imageElement$}
          src=${picture}
          decoding='async'
          onload=${store.markPictureLoaded}
          onerror=${store.rejectPicture}
          alt=${props.alt$?.() ?? props.alt ?? ''}
          style=${`
            position: absolute;
            inset: 0;
            width: 100%;
            height: 100%;
            object-fit: cover;
            visibility: ${isPictureLoaded ? 'inherit' : 'hidden'};
          `}
        />
      </span>
    `
  }

  if (!store.pk$() || !store.svg$()) {
    return h`<icon-user-circle props=${props} />`
  }

  return h`<f-svg props=${{ ...props, style$: store.svgStyle$, svg: store.svg$() }} />`
})
