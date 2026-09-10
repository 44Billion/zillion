import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-alert-triangle', ({ h, props }) => {
  // https://tabler.io/icons/icon/alert-triangle
  const store = useStore({ path$: ['M12 9v4', 'M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z', 'M12 16h.01'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
