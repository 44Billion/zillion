import { messageAttachment } from '#services/chat-attachments.js'
import { isChatInnerKind, CHAT_FILE_KIND, CHAT_TEXT_KIND } from '#services/chat-references.js'
import { compactWhitespace } from 'libp2r2p/nip27'
import { parseChatContent, trimBlockSeparators } from './chat-content.js'
import { shortNostrLabel, shortUrlLabel } from './reference-label.js'

function dayKey (date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

// A date belongs to the day, not to whichever message arrived first for it.
export function groupChatDays (messages) {
  const days = new Map()
  for (const message of messages) {
    const key = message.dayKey ?? 'fixture'
    if (!days.has(key)) days.set(key, { key, label: message.dayLabel, messages: [] })
    days.get(key).messages.push(message)
  }
  return [...days.values()]
}

// References of one kind-9 message: `q` tags are always accepted, and URIs
// found in the content keep their position (a `q` without URI renders first).
export function chatMessageReferences (event) {
  const items = parseChatContent(event?.content ?? '')
  const references = new Map()
  for (const tag of event?.tags ?? []) {
    if (tag?.[0] !== 'q' || typeof tag[1] !== 'string' || !tag[1]) continue
    if (!references.has(tag[1])) references.set(tag[1], { id: tag[1], position: 'start', fromQ: true, fromUri: false })
  }
  items.forEach((item, index) => {
    if (item.key !== 'event') return
    const id = item.event?.id
    if (!id) return
    const existing = references.get(id)
    references.set(id, {
      id,
      kind: item.event.kind,
      author: item.event.author,
      position: index,
      fromQ: existing?.fromQ === true,
      fromUri: true
    })
  })
  return { items, references: [...references.values()] }
}

// Whether this item paints as a block instead of an inline reference. It mirrors
// the content renderer: resolved kind 9 is a quote, a decodable kind 1063 or a
// local/marked-download URL is an attachment, everything else stays inline.
function isBlockItem (item, references) {
  if (item.key === 'event') {
    const resolved = references[item.event?.id]
    if (resolved?.kind === CHAT_TEXT_KIND) return true
    return resolved?.kind === CHAT_FILE_KIND && Boolean(messageAttachment(resolved))
  }
  if (item.key === 'url') return Boolean(item.url.nfile) || (item.url.download === '1' && !/^(image|video)\//.test(item.url.m ?? ''))
  return false
}

// Content parts ready to render: expanded blocks consume the structural line
// break that separated them, and empty leftovers disappear entirely.
export function augmentedContentItems (items, references = {}) {
  return trimBlockSeparators(items, item => isBlockItem(item, references))
    .filter(item => item.key !== 'text' || item.text.value !== '')
}

// Plain-text representation for previews and copy/share: augmented references
// (kind 9/1063) leave the text, everything else keeps today's compact label.
// Parts join like the rendered blocks do, so an augmented reference does not
// leave an empty line behind.
function displayText (items, references) {
  const parts = items.map(item => {
    if (item.key === 'text') return item.text.value
    if (item.key === 'event' && isChatInnerKind(references[item.event?.id]?.kind)) return ''
    if (item.key === 'url') {
      if (isChatInnerKind(references[item.url.nfile?.id]?.kind)) return ''
      return shortUrlLabel(item.url.value, item.url.ext)
    }
    const reference = item[item.key]
    const label = reference?.original ?? (item.key === 'hashtag' ? `#${reference?.value ?? ''}` : reference?.value ?? '')
    return item.key === 'app' || /^(?:nostr:)?(?:note|nevent|naddr|npub|nprofile|nrelay)1/i.test(label) ? shortNostrLabel(label) : label
  }).map(part => part.trim()).filter(Boolean)
  return compactWhitespace(parts.join('\n'))
}

// A quoted kind-9 message: one-line excerpt plus its first thumbnailable item
// (or inline filename) and caption, matching the existing quote visual.
export function chatQuoteModel (event, references = {}) {
  if (!event) return null
  const { items, references: refs } = chatMessageReferences(event)
  const attachmentRef = refs.map(ref => references[ref.id]).find(resolved => resolved?.kind === CHAT_FILE_KIND)
  const attachment = attachmentRef ? messageAttachment(attachmentRef) : null
  return {
    id: event.id, pubkey: event.pubkey, hearsay: !!event.hearsay,
    // Raw content is what reply thumbnails parse for their own candidates.
    content: event.content ?? '',
    text: displayText(items, references),
    attachment,
    caption: attachment?.caption ?? ''
  }
}

export function chatTimeline (events, { locale, now = Date.now(), t = value => value, references = {}, owner } = {}) {
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  let previousDay
  return events.flatMap(event => {
    // The feed is kind-9 only; file metadata (1063) is fetched through the
    // references of those messages instead of becoming a bubble itself.
    if (event?.kind != null && event.kind !== CHAT_TEXT_KIND) return []
    const date = new Date(event.created_at * 1000)
    const key = dayKey(date)
    const label = key === dayKey(today) ? t('Today') : key === dayKey(yesterday) ? t('Yesterday') : date.toLocaleDateString(locale)
    const { items, references: refs } = chatMessageReferences(event)
    const resolved = refs.map(reference => references[reference.id]).filter(Boolean)
    const fileEvent = resolved.find(candidate => candidate.kind === CHAT_FILE_KIND)
    const quotedEvent = resolved.find(candidate => candidate.kind === CHAT_TEXT_KIND)
    const attachment = fileEvent ? messageAttachment(fileEvent) : event.localAttachment ?? null
    const prepend = refs.filter(reference => reference.position === 'start' && isChatInnerKind(references[reference.id]?.kind))
    const message = {
      id: event.id,
      created_at: event.created_at,
      kind: event.kind ?? CHAT_TEXT_KIND,
      real: true,
      outgoing: !owner || event.pubkey === owner,
      status: event.status ?? 'saved',
      localSource: event.localSource,
      attachment,
      caption: attachment?.caption ?? '',
      quoted: quotedEvent ? chatQuoteModel(quotedEvent, references) : null,
      references: refs,
      prepend,
      text: compactWhitespace(event.content),
      displayText: displayText(items, references),
      replyTo: event.tags.find(tag => tag[0] === 'q')?.[1],
      time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      date: date.toLocaleDateString(locale), datetime: date.toISOString(),
      dayKey: key, dayLabel: key !== previousDay ? label : null
    }
    previousDay = key
    return message
  })
}
