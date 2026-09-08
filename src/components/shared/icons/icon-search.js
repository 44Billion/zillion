import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-search', ({ h, props }) => {
  // https://tabler.io/icons/icon/search
  const store = useStore({
    path$: ['M10 10m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
