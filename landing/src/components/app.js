import { f } from '#f'
import globalCss from '../assets/styles/global.css'

const style = document.createElement('style')
style.textContent = globalCss
document.head.append(style)

f('z-landing-app', ({ h }) => h`
  <main class="landing">
    <h1>Zillion</h1>
    <p>Hello world!</p>
  </main>
`)
