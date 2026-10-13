import { base64ToBytes, bytesToBase64 } from 'libp2r2p/base64'

// The session adapter captures optional methods at construction. Keep their
// forwarding functions stable while the injected same-identity surface changes,
// so capability recovery does not recreate the session or discard its outbox.
export function dynamicContentKeySigner (signer) {
  const invoke = (target, method, params) => {
    if (typeof target?.[method] !== 'function') throw Object.assign(new Error('Content-key method unavailable'), { code: 'UNSUPPORTED_METHOD' })
    return target[method](...params)
  }
  return {
    ...signer,
    doubleSignEvent: (...params) => invoke(signer, 'doubleSignEvent', params),
    nip44v3: {
      ...signer.nip44v3,
      encryptDoubleDH: (...params) => invoke(signer.nip44v3, 'encryptDoubleDH', params),
      decryptDoubleDH: (...params) => invoke(signer.nip44v3, 'decryptDoubleDH', params)
    },
    withSharedKey: (...params) => dynamicContentKeySigner(signer.withSharedKey(...params))
  }
}

// The library transport uses its Base64 signer contract. Conversion stays at
// this adapter; the injected launcher/vault channel always carries raw bytes.
export function messengerSigner (signer) {
  return {
    getPublicKey: () => signer.getPublicKey(),
    getRelays: () => signer.getRelays(),
    signEvent: event => signer.signEvent(event),
    nip44v3Encrypt: (peer, kind, scope, text) => signer.nip44v3.encrypt(peer, kind, scope, base64ToBytes(text).buffer),
    nip44v3Decrypt: async (peer, kind, scope, ciphertext) => bytesToBase64(new Uint8Array(await signer.nip44v3.decrypt(peer, kind, scope, ciphertext)))
  }
}
