import { parseChatContent } from './chat-content.js'
import { isViewerMime } from './viewer-media.js'
import { messageAttachment } from '#services/chat-attachments.js'

// Extract lightweight occurrences from loaded messages only. The viewer reads
// persisted files separately; chat activation can also identify a resolved file.
export function conversationMedia (messages, references = {}, { urlsOnly = false } = {}) {
  return messages.flatMap(message => {
    const media = []
    const seen = new Set()
    const add = (file, slot, eventId) => {
      if (!file || !isViewerMime(file.mime) || (!eventId && file.download === '1') || seen.has(file.url)) return
      try { if (new URL(file.url).protocol !== 'https:' && !(message.demo && /^data:image\/(?:jpeg|png|webp);base64,/.test(file.url))) return } catch { return }
      seen.add(file.url)
      if (urlsOnly && eventId) return
      media.push({ ...file, id: eventId ? `file:${eventId}` : `${message.id}:${slot}`, messageId: message.id, type: file.mime.startsWith('video/') ? 'video' : 'image', time: message.time, created_at: message.created_at ?? 0, orderId: message.id, slot: typeof slot === 'number' ? slot : -1 })
    }
    if (!message.real) add(message.attachment, 'attachment')
    // A URL repeated beside its known file reference is the same occurrence.
    const fileUrls = new Set((message.references ?? message.prepend ?? []).flatMap(reference => {
      const file = messageAttachment(references[reference.id])
      return file ? [file.url] : []
    }))
    for (const reference of message.prepend ?? []) {
      const event = references[reference.id]
      if (event?.kind === 1063) add(messageAttachment(event), `q-${reference.id}`, reference.id)
    }
    if (!message.real) return media
    parseChatContent(message.text ?? '').forEach((item, index) => {
      if (item.key === 'event') {
        const event = references[item.event.id]
        if (event?.kind === 1063) add(messageAttachment(event), index, item.event.id)
      } else if (item.key === 'url' && !fileUrls.has(item.url.value)) {
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
