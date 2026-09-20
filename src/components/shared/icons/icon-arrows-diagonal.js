import { f, useStore } from '#f'
import '#f/components/f-svg.js'

// https://github.com/tabler/tabler-icons/blob/main/icons/outline/arrows-diagonal.svg
f('icon-arrows-diagonal', ({ h, props }) => {
  const store = useStore({ path$: ['M16 4l4 0l0 4', 'M14 10l6 -6', 'M8 20l-4 0l0 -4', 'M4 20l6 -6'], viewBox$: '2 2 20 20' })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
