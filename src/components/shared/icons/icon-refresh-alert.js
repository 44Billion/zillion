import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-refresh-alert', ({ h, props }) => {
  // https://tabler.io/icons/icon/refresh-alert
  const store = useStore({
    path$: ['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4', 'M12 9l0 3', 'M12 15l.01 0'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
