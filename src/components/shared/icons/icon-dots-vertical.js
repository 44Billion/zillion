import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-dots-vertical', ({ h, props }) => {
  // https://tabler.io/icons/icon/dots-vertical
  const store = useStore({
    path$: ['M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M11 19a1 1 0 1 0 2 0a1 1 0 1 0 -2 0', 'M11 5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
