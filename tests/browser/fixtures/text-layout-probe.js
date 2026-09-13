// Test-only instrumentation: measure rendered geometry, not just scrollHeight's
// integer distance from the bottom. Keep running across the real history replay.
(() => {
  const probe = window.textLayoutProbe = { token: crypto.randomUUID(), frames: [] }
  const sample = () => {
    const timeline = document.querySelector('.chat-timeline')
    if (timeline) {
      const rows = [...timeline.querySelectorAll('.message-row')]
      const bubbles = rows.slice(-3).flatMap(row => {
        const bubble = row.querySelector('.chat-bubble')
        const text = row.querySelector('.message-text')
        if (!bubble || !text) return []
        const { height, top, bottom } = bubble.getBoundingClientRect()
        return [{ count: rows.length, text: text.innerText.trim(), height, top, bottom }]
      })
      probe.frames.push({
        pinned: timeline.scrollTop > 0 && timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 2,
        bubbles,
        animations: timeline.getAnimations({ subtree: true }).length
      })
    }
    if (probe.frames.length < 5000) requestAnimationFrame(sample)
  }
  requestAnimationFrame(sample)
})()
