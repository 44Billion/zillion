import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-x', ({ h, props }) => {
  // https://tabler.io/icons/icon/x
  const store = useStore({ path$: ['M18 6l-12 12', 'M6 6l12 12'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
