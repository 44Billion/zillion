import { isVideoControlPointer } from '#helpers/conversation-media.js'

// Own only activation. Native controls, scrolling and download intent retain
// their behavior; pointerdown never starts a message's long-press menu.
export function mediaOpenHandlers (open, file) {
  const activate = event => {
    event.stopPropagation()
    open?.(file(), event.currentTarget.closest?.('.media-frame, .attachment-frame')?.querySelector('video')?.currentTime ?? 0)
  }
  return {
    down: event => event.stopPropagation(),
    click: event => { if (!isVideoControlPointer(event)) activate(event) },
    expand: activate,
    key: event => {
      if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return
      event.preventDefault()
      activate(event)
    }
  }
}
