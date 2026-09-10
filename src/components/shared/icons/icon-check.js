import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-check', ({ h, props }) => {
  // https://tabler.io/icons/icon/check
  const store = useStore({
    path$: ['M5 12l5 5l10 -10'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
