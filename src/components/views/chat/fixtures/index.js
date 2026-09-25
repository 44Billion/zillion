import home from '#views/home/fixtures/home.json'
import fixture from './messages.json'
import weekendCoffee from './weekend-coffee.webp'

// Each fixture DM shares the sample exchange but ends with its home preview.
export function getMessages (person) {
  if (person.self) return fixture.selfMessages
  const preview = home.conversations.find(item => item.contactId === person.id)
  const latest = new Date(preview.lastMessageAt).getTime()
  const messages = fixture.messages.map((message, index, messages) => ({
    ...message,
    ...(index === messages.length - 1
      ? { text: preview.message.replace(/^You: /, ''), outgoing: preview.message.startsWith('You: ') }
      : {}),
    time: new Date(latest - (messages.length - 1 - index) * 180000).toISOString().slice(11, 16)
  }))
  if (/photo/i.test(preview.message)) {
    messages.push({
      id: 'promised-photo', outgoing: false, text: '', demo: true,
      attachment: { url: weekendCoffee, mime: 'image/webp', filename: 'weekend-coffee.webp', width: 540, height: 720 },
      time: new Date(latest + 60000).toISOString().slice(11, 16)
    })
  }
  return messages
}
