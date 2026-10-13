import { f, useStore } from '#f'
import '#shared/avatar.js'
import portraits from './fixtures/portraits.js'

f('z-home-avatar', ({ h, props }) => {
  const view = useStore({
    profile$ () {
      const person = props.person$()
      return person.isDefaultUser ? null : person.profile || { picture: portraits[person.avatar] }
    },
    pk$ () {
      const person = props.person$()
      return person.isDefaultUser ? '' : person.pubkey ?? (person.self ? '' : person.id) ?? ''
    }
  })
  // Self profiles come from the account store; sample portraits stay local.
  return h`<a-avatar props=${{ pk$: view.pk$, localOnly: true, profile$: view.profile$, alt: '' }} />`
})
