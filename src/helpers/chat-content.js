import { extractMedia } from 'libp2r2p/nip27'
import { appDecode } from 'libp2r2p/nip19'

const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }

export function parseChatContent (content) {
  const extract = text => extractMedia(text, { getMimeType: ({ ext }) => mimeTypes[ext?.toLowerCase()] }).map(item => {
    if (item.key !== 'url') return item
    const url = new URL(item.url.value)
    if (url.hostname !== 'njump.me') return item
    const pointer = extractMedia(url.pathname.slice(1))
    return pointer.length === 1 && pointer[0].key === 'event' ? pointer[0] : item
  })
  // App routing suffixes are launcher syntax; NIP-27 handles the Nostr pointer.
  const parts = []
  let cursor = 0
  for (const match of content.matchAll(/(?<![\w/])(?:nostr:)?(?:note|nevent|naddr)1[ac-hj-np-z02-9]+(\+{1,3}[a-zA-Z0-9]+)/g)) {
    const suffix = match[1]
    const pointer = match[0].slice(0, -suffix.length)
    const parsed = extract(pointer)
    try { appDecode(suffix) } catch { continue }
    if (parsed.length !== 1 || parsed[0].key !== 'event') continue
    parts.push(...extract(content.slice(cursor, match.index)), { key: 'event', event: { ...parsed[0].event, original: match[0], appSuffix: suffix } })
    cursor = match.index + match[0].length
  }
  parts.push(...extract(content.slice(cursor)))
  return parts
}
