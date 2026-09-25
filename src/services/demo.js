import fixtures from '#views/contacts/fixtures/people.json'
export const demoEnabled = typeof DEMO_ENABLED !== 'undefined' && DEMO_ENABLED
export const demoPeople = demoEnabled ? fixtures.map(person => ({ ...person, demo: true })) : []
