import { attachmentPlaceholder } from '#helpers/attachment-placeholder.js'
import { chatMessageReferences } from '#helpers/chat-timeline.js'
import { compareChatMessages } from '#helpers/conversation-preview.js'
import { messageAttachment } from './chat-attachments.js'
import { acquireAttachmentPreview, localAttachmentUrl } from './attachment-previews.js'
import { CHAT_PAGE_SIZE } from './chat-history.js'

// The same root may appear in several messages. Only local image/video files
// qualify, newest first; misses do not consume the five successful preparations.
export async function prefetchChatMedia (messages, resolve, { signal, prepare = acquireAttachmentPreview } = {}) {
  const seen = new Set()
  let count = 0
  for (const message of messages.toSorted((a, b) => compareChatMessages(b, a)).slice(0, CHAT_PAGE_SIZE)) {
    for (const reference of chatMessageReferences(message).references) {
      signal?.throwIfAborted()
      const file = messageAttachment(resolve(reference))
      if (!file || !/^(image|video)\//.test(file.mime) || !localAttachmentUrl(file) || seen.has(file.root)) continue
      seen.add(file.root)
      if (attachmentPlaceholder(file)) { if (++count === 5) return count; continue }
      let preview
      try {
        preview = await prepare(file, { signal, localOnly: true })
        if (preview) count++
      } catch { signal?.throwIfAborted() } finally { preview?.close() }
      if (count === 5) return count
    }
  }
  return count
}
