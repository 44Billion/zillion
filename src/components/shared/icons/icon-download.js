import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-download', ({ h, props }) => {
  // https://tabler.io/icons/icon/download
  const store = useStore({
    path$: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 11l5 5l5 -5', 'M12 4l0 12'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
