import { prepareMediaPreview } from '../../../src/services/media-preparation/index.js'
import { prepareAttachment } from '../../../src/services/chat-attachments.js'
window.runMediaPreview = async name => {
  const input = document.querySelector('input').files[0]
  const preview = await prepareMediaPreview(input, input.type)
  const img = new Image(); const url = URL.createObjectURL(preview.blob)
  try {
    img.src = url
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width; canvas.height = img.height
    const context = canvas.getContext('2d')
    context.drawImage(img, 0, 0)
    const pixels = context.getImageData(0, 0, img.width, img.height).data
    const result = { name, backend: preview.backend, width: preview.width, height: preview.height, thumbnailWidth: img.width, thumbnailHeight: img.height, hash: preview.thumbhash, pixel: [...pixels.slice(0, 4)] }
    if (/^png-c/.test(name)) {
      // These fixtures fit at native size. Compare every premultiplied pixel,
      // independently of the row decoder, against Chrome's original decode.
      const original = new Image(); const originalUrl = URL.createObjectURL(input)
      try {
        original.src = originalUrl
        await original.decode()
        context.clearRect(0, 0, canvas.width, canvas.height)
        context.drawImage(original, 0, 0)
        const reference = context.getImageData(0, 0, canvas.width, canvas.height).data
        let maximum = 0
        for (let index = 0; index < reference.length; index += 4) {
          maximum = Math.max(maximum, Math.abs(pixels[index + 3] - reference[index + 3]))
          for (let channel = 0; channel < 3; channel++) maximum = Math.max(maximum, Math.abs(pixels[index + channel] * pixels[index + 3] - reference[index + channel] * reference[index + 3]) / 255)
        }
        result.maximumPixelError = maximum
      } finally { original.removeAttribute('src'); URL.revokeObjectURL(originalUrl) }
    }
    canvas.width = canvas.height = 0
    return result
  } finally { img.removeAttribute('src'); URL.revokeObjectURL(url) }
}
window.cancelMediaPreview = async () => {
  const input = document.querySelector('input').files[0]; const controller = new AbortController()
  const started = performance.now()
  const work = prepareMediaPreview(input, input.type, { signal: controller.signal })
  const timer = setTimeout(() => controller.abort(), 100)
  try { await work; return { canceled: false } } catch (error) { return { canceled: error.name === 'AbortError', elapsed: performance.now() - started } } finally { clearTimeout(timer) }
}
window.checkPreparedBytes = async () => {
  const file = document.querySelector('input').files[0]
  const attachment = await prepareAttachment(file, { compress: false })
  const img = new Image()
  try {
    img.src = attachment.source
    await img.decode()
    return { size: attachment.metadata.size, originalSize: file.size, previewWidth: img.width, originalWidth: attachment.metadata.width, source: attachment.source }
  } finally { img.removeAttribute('src'); attachment.close() }
}
