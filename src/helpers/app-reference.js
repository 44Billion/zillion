import { encodeUserReference } from 'libp2r2p/nip27'
import { encodeAppUrl, tryDecodeAppUrl } from 'libp2r2p/url'

export function appReferenceUrl (app) {
  let segment = app.entity
  if (app.type === 'named') {
    const user = app.user
    // Only the launcher's root author can be omitted; named users remain explicit.
    segment = encodeAppUrl({ appName: app.appName, channel: app.channel, user: encodeUserReference(user) })
    if (user.type === 'nip05' && user.local === '_' && user.domain === '44billion.net') {
      const alias = app.prefix + encodeURIComponent(app.appName)
      // Long names can otherwise be mistaken for encoded app entities.
      if (tryDecodeAppUrl(alias)?.type === 'named') segment = alias
    }
  }
  return `https://44billion.net/${segment}`
}
