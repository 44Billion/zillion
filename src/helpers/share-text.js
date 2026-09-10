import { copyTextToClipboard } from './copy-text.js'

export function canShareText (text) {
  if (typeof navigator.share !== 'function') return false
  const policy = document.permissionsPolicy ?? document.featurePolicy
  if (policy?.allowsFeature && !policy.allowsFeature('web-share')) return false
  try { return !navigator.canShare || navigator.canShare({ text }) } catch (_) { return false }
}

export async function shareText (text) {
  if (canShareText(text)) {
    try { await navigator.share({ text }); return 'shared' } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
    }
  }
  await copyTextToClipboard(text)
  return 'copied'
}
