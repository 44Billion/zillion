import { parseChatContent } from './chat-content.js'
import { messageAttachment } from '#services/chat-attachments.js'

// Only media expanded in this conversation belongs to its viewer. Quotes,
// previews, download-only links and the owner's global file catalog are excluded.
export function conversationMedia (messages, references = {}) {
  return messages.flatMap(message => {
    const media = []
    const seen = new Set()
    const add = (file, slot) => {
      if (!file || !/^(image|video)\//.test(file.mime ?? '') || file.download === '1' || seen.has(file.url)) return
      try { if (new URL(file.url).protocol !== 'https:') return } catch { return }
      seen.add(file.url)
      media.push({ ...file, id: `${message.id}:${slot}`, messageId: message.id, type: file.mime.startsWith('video/') ? 'video' : 'image', time: message.time })
    }
    if (!message.real) add(message.attachment, 'attachment')
    for (const reference of message.prepend ?? []) {
      const event = references[reference.id]
      if (event?.kind === 1063) add(messageAttachment(event), `q-${reference.id}`)
    }
    if (!message.real) return media
    parseChatContent(message.text ?? '').forEach((item, index) => {
      if (item.key === 'event') {
        const event = references[item.event.id]
        if (event?.kind === 1063) add(messageAttachment(event), index)
      } else if (item.key === 'url') {
        add({ ...item.url.nfile, ...item.url, url: item.url.value, mime: item.url.m }, index)
      }
    })
    return media
  })
}

export function selectedMediaId (hash) {
  try { return decodeURIComponent((hash || '').replace(/^#/, '')) } catch { return '' }
}

// User-agent controls don't expose their shadow nodes. Reserve their entire
// bottom strip; the explicit expand button remains keyboard accessible.
export function isVideoControlPointer (event) {
  const video = event.target?.closest?.('video')
  if (!video?.controls) return false
  if (event.type === 'keydown' || (event.detail === 0 && event.type === 'click')) return true
  const rect = video.getBoundingClientRect()
  return event.clientY >= rect.bottom - Math.min(64, rect.height * 0.4)
}

export function mediaSwipe (dx, dy) {
  const axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'
  const distance = axis === 'x' ? dx : dy
  return Math.abs(distance) >= 50 ? { axis, step: distance < 0 ? 1 : -1 } : null
}
