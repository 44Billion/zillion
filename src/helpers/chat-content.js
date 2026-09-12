import { extractMedia } from 'libp2r2p/nip27'

const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }

export function parseChatContent (content) {
  return extractMedia(content, { getMimeType: ({ ext }) => mimeTypes[ext?.toLowerCase()] })
}
