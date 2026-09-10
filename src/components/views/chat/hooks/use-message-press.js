import { useStore, useTask } from '#f'

export function useMessagePress (open) {
  const press = useStore(() => ({
    timer: null,
    pointer: null,
    x: 0,
    y: 0,
    triggered: false,
    cancel () {
      clearTimeout(this.timer)
      this.timer = null
      this.pointer = null
    },
    down (event) {
      this.cancel()
      this.triggered = false
      if (event.pointerType === 'mouse' || !event.isPrimary || event.button !== 0) return
      this.pointer = event.pointerId
      this.x = event.clientX
      this.y = event.clientY
      this.timer = setTimeout(() => {
        this.triggered = true
        this.cancel()
        open(false)
      }, 500)
    },
    move (event) {
      if (event.pointerId === this.pointer && Math.hypot(event.clientX - this.x, event.clientY - this.y) > 10) this.cancel()
    },
    context (event) {
      event.preventDefault()
      this.cancel()
      open(event.pointerType === '' || (event.detail === 0 && event.clientX === 0 && event.clientY === 0))
    },
    key (event) {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault()
        open(true)
      }
    },
    click (event) {
      if (this.triggered) { event.preventDefault(); event.stopPropagation(); this.triggered = false }
    }
  }))
  useTask(({ cleanup }) => {
    window.addEventListener('scroll', press.cancel, true)
    window.addEventListener('blur', press.cancel)
    cleanup(() => {
      press.cancel()
      window.removeEventListener('scroll', press.cancel, true)
      window.removeEventListener('blur', press.cancel)
    })
  })
  return press
}
