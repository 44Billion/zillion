// Relay prose is untrusted and has no stable meaning. Only recognize exact
// local codes or the leading NIP-01/NIP-42 prefix of a relay rejection.
const localCodes = new Map([
  ['PERMISSION_DENIED', 'permission'], ['ACCESS_DENIED', 'permission'], ['REVOKED', 'permission'], ['NOT_IN_PERSONA', 'permission'],
  ['VAULT_LOCKED', 'locked'], ['SIGNER_LOCKED', 'locked'], ['ACCOUNT_LOCKED', 'locked'], ['LOCKED', 'locked'],
  ['READ_ONLY_ACCOUNT', 'readonly'], ['READ_ONLY_TEMPORARY_ACCOUNT', 'readonly'], ['READ_ONLY', 'readonly'], ['ACCOUNT_READ_ONLY', 'readonly'],
  ['CHAT_UNAVAILABLE', 'unavailable'],
  ['FILE_UNAVAILABLE', 'file'], ['FILE_TRANSFER_UNAVAILABLE', 'file'],
  ['QUOTA_EXCEEDED', 'quota'], ['QUOTA_EXCEEDED_ERROR', 'quota'], ['STORAGE_FULL', 'quota'],
  ['MESSAGE_STORAGE_FAILED', 'storage'],
  ['PUBLISH_TIMEOUT', 'connection'], ['CONNECTION_CLOSED', 'connection'], ['NETWORK_ERROR', 'connection']
])
const relayCodes = new Map([
  ['blocked', 'access'], ['restricted', 'access'], ['auth-required', 'authentication'],
  ['rate-limited', 'rate'], ['pow', 'pow'], ['invalid', 'invalid'],
  ['mute', 'relay'], ['error', 'relay'], ['duplicate', 'publication']
])

function relayFailure (reason) {
  if (['timeout', 'connection', 'transport', 'network'].includes(reason?.category)) return 'connection'
  const text = typeof reason === 'string' ? reason : reason?.message
  const prefix = typeof text === 'string' ? /^([a-z-]+):/.exec(text.trim())?.[1] : null
  return relayCodes.get(prefix) || 'publication'
}

export function sendFailure (error) {
  if (error?.name === 'AbortError') return null
  if (error?.name === 'QuotaExceededError') return 'quota'
  if (error?.code === 'MESSAGE_NOT_PUBLISHED') {
    const failures = Array.isArray(error.reports) ? error.reports.flatMap(report => Array.isArray(report?.errors) && report.errors.length ? report.errors.map(item => relayFailure(item?.reason)) : ['publication']) : []
    // Conflicting relay policies do not justify a single specific remedy.
    return failures.length && failures.every(value => value === failures[0]) ? failures[0] : 'publication'
  }
  return localCodes.get(error?.code) || localCodes.get(error?.message) || 'generic'
}

export const sendFailureMessages = {
  generic: 'Could not send this message. Try again.',
  publication: 'The servers did not confirm this send. Try again later.',
  access: 'The servers refused this message because of their access rules.',
  authentication: 'The servers require authentication before accepting this message.',
  rate: 'Too many messages were sent. Wait a moment before retrying.',
  pow: 'The servers require proof of work that this app cannot provide.',
  invalid: 'The servers rejected this message as invalid.',
  relay: 'The servers could not accept this message. Try again later.',
  connection: 'Could not reach the servers. Check your connection and retry.',
  permission: 'Sending was not authorized. Review the app permissions in the launcher.',
  locked: 'Unlock your account in the launcher, then retry sending.',
  readonly: 'This account is read-only. Use an account that can sign messages.',
  unavailable: 'The conversation is unavailable. Check your account and contact access, then retry.',
  file: 'The attachment is unavailable. Attach the file again in a new message.',
  quota: 'There is not enough storage. Free up space on your device and retry.',
  storage: 'Could not save the message on this device. Try again.'
}
