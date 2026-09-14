import { extractMedia } from 'libp2r2p/nip27'

const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }

export function parseChatContent (content) {
  return extractMedia(content, { getMimeType: ({ ext }) => mimeTypes[ext?.toLowerCase()] }).map(item => {
    if (item.key !== 'url') return item
    const url = new URL(item.url.value)
    if (url.hostname !== 'njump.me') return item
    const pointer = extractMedia(url.pathname.slice(1))
    return pointer.length === 1 && pointer[0].key === 'event' ? pointer[0] : item
  })
}
