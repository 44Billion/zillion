import { f } from '#f'
import { useAccount } from '#hooks/use-account.js'

f('z-contact-readiness-driver', ({ h }) => {
  window.contactBoot.account = useAccount()
  return h``
})
const host = document.createElement('div')
host.innerHTML = '<z-contact-readiness-driver></z-contact-readiness-driver>'
document.body.append(host)
