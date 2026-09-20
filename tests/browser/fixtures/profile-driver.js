import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'
import { i18n } from '#i18n/index.js'

f('z-profile-test-driver', ({ h }) => {
  const account = useAccount()
  window.profileTest = {
    setOwn (profile, pubkey = 'a'.repeat(64)) { account.pubkey$(pubkey); account.profile$(profile) },
    profile: () => account.profile$(),
    locale: i18n.setLocale
  }
  return h`<span hidden></span>`
})
const host = document.createElement('div')
host.innerHTML = '<z-profile-test-driver></z-profile-test-driver>'
document.body.append(host)
