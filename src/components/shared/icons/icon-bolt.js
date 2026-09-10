import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-bolt', ({ h, props }) => {
  // https://tabler.io/icons/icon/bolt
  const store = useStore({
    path$: ['M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
