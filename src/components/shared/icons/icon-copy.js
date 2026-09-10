import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-copy', ({ h, props }) => {
  // https://tabler.io/icons/icon/copy
  const store = useStore({
    path$: ['M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666', 'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
