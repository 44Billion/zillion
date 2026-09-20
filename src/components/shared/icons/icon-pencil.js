import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-pencil', ({ h, props }) => {
  // https://tabler.io/icons/icon/pencil
  const store = useStore({
    path$: ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
