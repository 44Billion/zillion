import { f, useLocation } from '#f'

// A test-only consumer of the public navigation API, sharing its history store.
f('z-route-test-driver', ({ h }) => {
  window.testNavigation = useLocation({ find: () => null })
  return h`<span hidden></span>`
})
const container = document.createElement('div')
container.innerHTML = '<z-route-test-driver></z-route-test-driver>'
document.body.append(container)
