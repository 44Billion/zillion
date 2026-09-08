import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-chevron-down', ({ h, props }) => {
  // https://tabler.io/icons/icon/chevron-down
  const store = useStore({ path$: ['M6 9l6 6l6 -6'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
