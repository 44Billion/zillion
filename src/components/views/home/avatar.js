import { f, useStore } from '#f'
import '#shared/avatar.js'
import portraits from './fixtures/portraits.js'

f('z-home-avatar', ({ h, props }) => {
  const view = useStore({
    profile$ () { return { picture: portraits[props.person$().avatar] } }
  })
  // A supplied data URL without a public key keeps the preview entirely local.
  return h`<a-avatar props=${{ pk: '', profile$: view.profile$, alt: '' }} />`
})
