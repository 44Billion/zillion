import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-clock', ({ h, props }) => {
  // https://tabler.io/icons/icon/clock
  const store = useStore({ path$: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 7v5l3 3'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
