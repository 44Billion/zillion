import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-paperclip', ({ h, props }) => {
  // https://tabler.io/icons/icon/paperclip
  const store = useStore({
    path$: ['M15 7l-6.5 6.5a1.5 1.5 0 0 0 3 3l6.5 -6.5a3 3 0 0 0 -6 -6l-6.5 6.5a4.5 4.5 0 0 0 9 9l6.5 -6.5'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
