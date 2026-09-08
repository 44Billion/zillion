import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-pin', ({ h, props }) => {
  // https://tabler.io/icons/icon/pin
  const store = useStore({
    path$: [
      'M15 4.5l-4 4l-4 1.5l-1.5 1.5l7 7l1.5 -1.5l1.5 -4l4 -4',
      'M9 15l-4.5 4.5',
      'M14.5 4l5.5 5.5'
    ],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
