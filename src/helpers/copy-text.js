// Preserve the composer's focus and selection when the legacy fallback is needed.
export async function copyTextToClipboard (text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return } catch (_) {}
  }
  const active = document.activeElement
  const selection = window.getSelection()
  const ranges = Array.from({ length: selection?.rangeCount ?? 0 }, (_, index) => selection.getRangeAt(index).cloneRange())
  const fieldSelection = active && typeof active.selectionStart === 'number'
    ? [active.selectionStart, active.selectionEnd, active.selectionDirection]
    : null
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;font-size:16rem'
  document.body.append(textarea)
  try {
    textarea.select()
    if (!document.execCommand('copy')) throw new Error('Copy failed')
  } finally {
    textarea.remove()
    active?.focus({ preventScroll: true })
    if (fieldSelection) active.setSelectionRange(...fieldSelection)
    else if (selection) {
      selection.removeAllRanges()
      for (const range of ranges) selection.addRange(range)
    }
  }
}
