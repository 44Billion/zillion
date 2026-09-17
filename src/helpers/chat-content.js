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

// A reference the bubble expands into a block (quote or attachment) owns its
// own line, so the separator the author typed after it is structural: spaces
// and tabs would indent the next line and a line break would paint an extra
// empty one. Consume that first whitespace run while keeping one line break for
// each extra one, so `\n\n` still asks for a visible blank line.
export function trimBlockSeparators (items, isBlock) {
  return items.map((item, index) => {
    if (index === 0 || item.key !== 'text' || !isBlock(items[index - 1])) return item
    const value = trimBlockSeparator(item.text.value)
    return value === item.text.value ? item : { ...item, text: { ...item.text, value } }
  })
}

function trimBlockSeparator (value) {
  const run = /^\s+/.exec(value)?.[0]
  if (!run) return value
  const breaks = run.match(/\r\n|[\r\n]/g)?.length ?? 0
  return (breaks > 1 ? '\n'.repeat(breaks - 1) : '') + value.slice(run.length)
}
