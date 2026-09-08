import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-circle-plus', ({ h, props }) => {
  // https://tabler.io/icons/icon/circle-plus
  const store = useStore({
    path$: ['M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0', 'M9 12l6 0', 'M12 9l0 6'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
