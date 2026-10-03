import { chatMessageReferences, chatTimeline } from './chat-timeline.js'
import { fileName } from './attachment-presentation.js'
import { compactWhitespace } from 'libp2r2p/nip27'

// Same order as the chat: newest timestamp, then lowest inner event ID.
export const compareChatMessages = (a, b) => a.created_at - b.created_at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

// First loaded message newer than the read anchor; null when everything shown
// is already read, which is when the unread divider disappears.
export function firstUnreadMessageId (messages, anchor) {
  if (!anchor) return null
  return messages.find(message => compareChatMessages(message, anchor) > 0)?.id ?? null
}

export function conversationPreview (event, references = {}, t = value => value) {
  if (!event) return ''
  // Known chat pointers are structural even while their local metadata is
  // unavailable. The list must not flash an opaque nevent in their place.
  const resolved = { ...references }
  let fileReference = false
  for (const ref of chatMessageReferences(event).references) {
    if (ref.kind === 1063) fileReference = true
    if ([9, 1063].includes(ref.kind) && !resolved[ref.id]) resolved[ref.id] = { kind: ref.kind }
  }
  const preview = chatTimeline([event], { references: resolved, t })[0]
  if (!preview) return ''
  const attachment = preview.attachment || event.localAttachment
  return compactWhitespace(attachment?.caption || preview.displayText || (attachment ? fileName(attachment, t('unnamed-file')).full : t(fileReference ? 'File' : 'Message')))
}
