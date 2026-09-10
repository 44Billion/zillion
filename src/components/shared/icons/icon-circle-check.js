import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-circle-check', ({ h, props }) => {
  // https://tabler.io/icons/icon/circle-check
  const store = useStore({ path$: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M9 12l2 2l4 -4'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
