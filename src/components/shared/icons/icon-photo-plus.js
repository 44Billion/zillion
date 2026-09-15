import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-photo-plus', ({ h, props }) => {
  // https://tabler.io/icons/icon/photo-plus
  const store = useStore({
    path$: ['M15 8h.01', 'M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5', 'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l4 4', 'M14 14l1 -1c.67 -.644 1.45 -.824 2.182 -.54', 'M16 19h6', 'M19 16v6'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
