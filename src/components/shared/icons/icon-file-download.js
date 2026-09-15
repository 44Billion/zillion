import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-file-download', ({ h, props }) => {
  // https://tabler.io/icons/icon/file-download
  const store = useStore({
    path$: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2', 'M12 17v-6', 'M9.5 14.5l2.5 2.5l2.5 -2.5'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
