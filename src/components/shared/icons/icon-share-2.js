import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-share-2', ({ h, props }) => {
  // https://tabler.io/icons/icon/share-2
  const store = useStore({
    path$: ['M8 9h-1a2 2 0 0 0 -2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-8a2 2 0 0 0 -2 -2h-1', 'M12 14v-11', 'M9 6l3 -3l3 3'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
