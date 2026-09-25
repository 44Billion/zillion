import { f, useStore } from '#f'
import '#shared/avatar.js'
import portraits from './fixtures/portraits.js'

f('z-home-avatar', ({ h, props }) => {
  const view = useStore({
    profile$ () { return props.person$().profile ? props.person$().profile : { picture: portraits[props.person$().avatar] } },
    pk$ () { return props.person$().pubkey ?? '' }
  })
  // Self profiles come from the account store; sample portraits stay local.
  return h`<a-avatar props=${{ pk$: view.pk$, localOnly: true, profile$: view.profile$, alt: '' }} />`
})
