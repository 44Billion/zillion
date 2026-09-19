import { f, useStore } from '#f'
import '#views/home/contacts.js'
import people from '#views/contacts/fixtures/people.json'

f('z-contacts-probe', ({ h }) => {
  const view = useStore({ contacts$: people.slice(0, 2) })
  window.contactStripProbe = { setCount: count => view.contacts$(people.slice(0, count)) }
  return h`<div class="strip-probe" style="width:390px"><z-home-contacts props=${{ contacts$: view.contacts$ }} /></div>`
})
