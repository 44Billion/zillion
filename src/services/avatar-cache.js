import { createMediaCache } from './media-cache.js'

// Independent capacity prevents conversation images from evicting avatars.
export function createAvatarCache (options = {}) {
  return createMediaCache({ prefix: 'zillion:avatars:v1', maxBytes: 32 * 1024 * 1024, ...options })
}

export default createAvatarCache()
