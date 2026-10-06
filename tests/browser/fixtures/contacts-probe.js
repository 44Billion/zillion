import { f, useStore } from '#f'
import '#views/home/contacts.js'
import people from '#views/contacts/fixtures/people.json'
import { orderHomeContacts } from '#services/contact-order.js'

f('z-contacts-probe', ({ h }) => {
  const view = useStore({ contacts$: people.slice(0, 2) })
  const self = { id: 'user', pubkey: 'user', self: true, name: 'Zzz self', shortName: 'Self', profile: {}, unread: 0 }
  const startup = Array.from({ length: 24 }, (_, index) => ({ ...people[index % people.length], id: `probe-${index}`, name: `Contact ${String(index).padStart(2, '0')}`, pinned: index < 2 }))
  window.contactStripProbe = {
    setCount: count => view.contacts$(people.slice(0, count)),
    start: () => view.contacts$([self]),
    grow: () => view.contacts$(orderHomeContacts([...startup, self], { ids: startup.map(person => person.id) })),
    sort: () => view.contacts$(orderHomeContacts([...startup, { ...self, name: 'A self' }], { alphabetical: true }))
  }
  return h`<div class="strip-probe" style="width:390px"><z-home-contacts props=${{ contacts$: view.contacts$ }} /></div>`
})
