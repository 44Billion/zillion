import fixtures from '#views/contacts/fixtures/people.json'
import portraits from '#views/home/fixtures/portraits.js'

export const demoEnabled = typeof DEMO_ENABLED !== 'undefined' && DEMO_ENABLED
export const demoPeople = demoEnabled
  ? fixtures.map(person => ({
    ...person,
    profile: person.profile ? { picture: portraits[person.avatar], ...person.profile } : undefined,
    demo: true
  }))
  : []
