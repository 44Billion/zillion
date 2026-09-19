import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-user-plus', ({ h, props }) => {
  // https://tabler.io/icons/icon/user-plus
  const store = useStore({
    path$: ['M8 7a4 4 0 1 0 8 0a4 4 0 0 0 -8 0', 'M16 19h6', 'M19 16v6', 'M6 21v-2a4 4 0 0 1 4 -4h4'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
