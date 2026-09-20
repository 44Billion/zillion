import { f, useStore } from '#f'
import '#f/components/f-svg.js'

f('icon-currency-bitcoin', ({ h, props }) => {
  // https://tabler.io/icons/icon/currency-bitcoin
  const store = useStore({
    path$: ['M6 6h8a3 3 0 0 1 0 6a3 3 0 0 1 0 6h-8', 'M8 6l0 12', 'M8 12l6 0', 'M9 3l0 3', 'M13 3l0 3', 'M9 18l0 3', 'M13 18l0 3'],
    viewBox$: '2 2 20 20'
  })
  return h`<f-svg props=${{ ...store, ...props }} />`
})
