import { f } from '#f'
import { t, useInitI18n } from '../i18n/index.js'
import './shared/language-control.js'
import { themeCss } from '../assets/styles/theme.js'
import globalCss from '../assets/styles/global.css'
import './shared/icon.js'
import './shared/theme-control.js'
import './views/hero.js'
import './views/privacy.js'
import './views/horizon.js'

const style = document.createElement('style')
style.textContent = themeCss + globalCss
document.head.append(style)

f('z-landing-app', ({ h }) => {
  useInitI18n()
  return h`
  <a class="skip-link" href="#main">${t('Skip to content')}</a>
  <header class="site-header shell">
    <a class="wordmark" href="./" aria-label=${t('Zillion home')}>
      <img src="./zillion.icon.svg" width="40" height="40" alt="">
      <span>Zillion</span>
    </a>
    <nav class="header-actions" aria-label=${t('Main navigation')}>
      <a class="source-link" aria-label=${t('Source code')} href="https://github.com/44Billion/zillion">
        <z-landing-icon props=${{ name: 'code' }} /><span>${t('Source')}</span>
      </a>
      <span class="header-divider" aria-hidden="true"></span>
      <z-language-control />
      <z-theme-control />
    </nav>
  </header>
  <main id="main" tabindex="-1">
    <z-landing-hero />
    <z-landing-privacy />
    <z-landing-horizon />
  </main>
  <footer class="site-footer shell">
    <a class="wordmark footer-wordmark" href="./" aria-label=${t('Zillion home')}>
      <img src="./zillion.icon.svg" width="28" height="28" alt="">
      <span>Zillion</span>
    </a>
    <p>${t('Private by design. Open by nature.')}</p>
    <nav aria-label=${t('Project links')}>
      <a href="https://github.com/44Billion/zillion">${t('Source code')}<span aria-hidden="true">↗</span></a>
      <a href="https://github.com/44Billion/zillion/blob/main/docs/private-chats.md">${t('Documentation')}<span aria-hidden="true">↗</span></a>
    </nav>
  </footer>
`
})
