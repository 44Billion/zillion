import { bytesToBase64Url } from 'libp2r2p/base64'

export function getRandomId () {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(12)))
}
