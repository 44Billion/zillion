import { useMemo, useTask } from '#f'
import { useAccount } from './use-account.js'
import { createAccountNotice } from '#services/account-notice.js'
import { show } from '#shared/toast.js'
import { demoEnabled } from '#services/demo.js'
import { getT } from '#i18n/index.js'
import locales from './account-notice-locales.json'

const t = getT(locales)
const messages = {
  locked: () => t('Unlock your account in the credential vault to load contacts and chats.'),
  readonly: () => t('Import the private key or bunker URL for this account into the credential vault.')
}

// The account root already owns the signer subscription. Retained routes and
// toast renders only observe that state, without another API call or retry loop.
export function useAccountNotice () {
  const account = useAccount()
  const notice = useMemo(() => createAccountNotice({ show, messages }))
  useTask(({ track }) => {
    const [owner, state] = track(() => [account.pubkey$(), account.signerState$()])
    if (!demoEnabled) notice.update(owner, state)
  })
  useTask(({ cleanup }) => cleanup(notice.close))
}
