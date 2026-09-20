import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-user', ({ h, props }) => {
  // https://tabler.io/icons/icon/user
  const store = useStore({
    path$: ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M6 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
