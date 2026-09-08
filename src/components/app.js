import { f } from '#f'
import { themeCss } from '#assets/styles/theme.js'
import globalCss from '#assets/styles/global.css'
import '#views/home/index.js'

const style = document.createElement('style')
style.textContent = themeCss + globalCss
document.head.append(style)

f('z-app', ({ h }) => h`<z-home />`)
