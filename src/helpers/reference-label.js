import { parseChatContent } from './chat-content.js'

const limit = 22

export function shortUrlLabel (value, extension = '') {
  const label = value.replace(/^https?:\/\/(?:www\.)?/i, '').replace(/\/$/, '')
  const suffix = [...extension.replace(/^\./, '')].slice(0, limit).join('')
  const characters = [...label]
  const length = Math.max(0, limit - [...suffix].length)
  return characters.length > limit ? characters.slice(0, length).join('').replace(/\.+$/, '') + '…' + suffix : label
}

export function shortNostrLabel (value) {
  const label = value.replace(/^nostr:/i, '')
  const characters = [...label]
  return characters.length > limit ? characters.slice(0, limit).join('').replace(/\.+$/, '') + '…' : label
}

// Quotes stay plain text: reuse reference labels without fetching previews.
export function shortQuotedText (text) {
  return parseChatContent(text).map(item => {
    if (item.key === 'text') return item.text.value
    if (item.key === 'url') return shortUrlLabel(item.url.value, item.url.ext)
    const reference = item[item.key]
    const label = reference.original ?? (item.key === 'hashtag' ? `#${reference.value}` : reference.value)
    return /^(?:nostr:)?(?:note|nevent|naddr|npub|nprofile|nrelay)1/i.test(label) ? shortNostrLabel(label) : label
  }).join('')
}
