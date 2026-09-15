import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-file-text-shield', ({ h, props }) => {
  // https://tabler.io/icons/icon/file-text-shield
  const store = useStore({
    path$: ['M13 3v4a.997 .997 0 0 0 1 1h4', 'M11 21h-5a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v3.5', 'M8 9h1', 'M8 12.994l3 0', 'M8 16.997l2 0', 'M21 15.994c0 4 -2.5 6 -3.5 6s-3.5 -2 -3.5 -6c1 0 2.5 -.5 3.5 -1.5c1 1 2.5 1.5 3.5 1.5'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
