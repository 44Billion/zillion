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

export function chatTimeline (events, { locale, now = Date.now(), t = value => value } = {}) {
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  let previousDay
  return events.map(event => {
    const date = new Date(event.created_at * 1000)
    const key = dayKey(date)
    const label = key === dayKey(today) ? t('Today') : key === dayKey(yesterday) ? t('Yesterday') : date.toLocaleDateString(locale)
    const message = {
      id: event.id, text: event.content, real: true, outgoing: true,
      replyTo: event.tags.find(tag => tag[0] === 'q')?.[1],
      time: date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }),
      date: date.toLocaleDateString(locale), datetime: date.toISOString(),
      dayKey: key, dayLabel: key !== previousDay ? label : null
    }
    previousDay = key
    return message
  })
}
