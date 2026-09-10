import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-alert-circle', ({ h, props }) => {
  // https://tabler.io/icons/icon/alert-circle
  const store = useStore({ path$: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 8v4', 'M12 16h.01'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
