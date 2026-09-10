import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-send-2', ({ h, props }) => {
  // https://tabler.io/icons/icon/send-2
  const store = useStore({
    path$: ['M4.698 4.034l16.302 7.966l-16.302 7.966a.503 .503 0 0 1 -.546 -.124a.555 .555 0 0 1 -.12 -.568l2.468 -7.274l-2.468 -7.274a.555 .555 0 0 1 .12 -.568a.503 .503 0 0 1 .546 -.124', 'M6.5 12h14.5'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
