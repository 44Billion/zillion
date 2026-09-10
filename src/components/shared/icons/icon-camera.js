import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-camera', ({ h, props }) => {
  // https://tabler.io/icons/icon/camera
  const store = useStore({
    path$: ['M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2', 'M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
