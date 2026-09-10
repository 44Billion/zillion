import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-info-circle', ({ h, props }) => {
  // https://tabler.io/icons/icon/info-circle
  const store = useStore({ path$: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
