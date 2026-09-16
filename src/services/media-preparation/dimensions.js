// Breakpoints describe the shorter DISPLAY side, after rotation/SAR.
export function compressionDimensions (width, height, { even = false } = {}) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('INVALID_MEDIA_DIMENSIONS')
  const shorter = Math.min(width, height)
  const limit = shorter >= 1080 ? 1080 : shorter >= 720 ? 720 : 480
  const scale = Math.min(1, limit / shorter)
  const round = value => even ? Math.floor(value / 2) * 2 : Math.round(value)
  const result = { width: round(width * scale), height: round(height * scale) }
  if (result.width < 1 || result.height < 1) throw new Error('UNSUPPORTED_COMPRESSION_DIMENSIONS')
  // Bound output working surfaces, not the upload. Unsupported jobs keep original.
  if (result.width * result.height > 8 * 1024 * 1024) throw new Error('COMPRESSION_SURFACE_LIMIT')
  return result
}

export function compressedName (name, extension) {
  const base = String(name || 'file').replace(/\.[^.]+$/, '') || 'file'
  return `${base}.${extension}`
}
