import { f } from '#f'
import { t } from '../../i18n/index.js'
import platformIcon from '../../assets/media/44b.png'
import lightConversation from '../../assets/media/conversation-light.webp'
import darkConversation from '../../assets/media/conversation-dark.webp'

f('z-landing-hero', ({ h, s }) => h`
  <section class="hero shell" aria-labelledby="hero-title">
    <div class="hero-copy">
      <p class="eyebrow"><span class="status-dot" aria-hidden="true"></span>${t('OPEN-SOURCE NOSTR MESSENGER')}</p>
      <h1 id="hero-title">${t('Privacy runs\ndeeper.').split('\n')[0]}<br><em>${t('Privacy runs\ndeeper.').split('\n')[1]}</em></h1>
      <p class="hero-description">${t('Private messaging on Nostr, protected by two keys working together.')}</p>
      <div class="availability">
        <p class="micro-label">${t('AVAILABLE ON 44BILLION.NET')}</p>
        <a class="launch-button" href="https://44billion.net/+zillion">
          <span class="launch-symbol" aria-hidden="true"><img src=${platformIcon} width="48" height="48" alt=""></span>
          <span class="launch-label"><strong>${t('Open Zillion')}</strong><span>${t('No download required')}</span></span>
          <z-landing-icon props=${{ name: 'northeast' }} />
        </a>
      </div>
      <a class="beneath-link" href="#privacy">${t('A little of what’s underneath')}<z-landing-icon props=${{ name: 'arrow' }} /></a>
    </div>
    <figure class="hero-visual">
      <div class="orbit-art" aria-hidden="true">
        ${s`<svg viewBox="0 0 580 600" fill="none">
          <ellipse class="orbit identity-orbit" cx="290" cy="292" rx="230" ry="173" transform="rotate(-48 290 292)" />
          <ellipse class="orbit content-orbit" cx="290" cy="310" rx="230" ry="173" transform="rotate(48 290 310)" />
          <circle class="orbit-point purple-fill" cx="81" cy="183" r="5" />
          <circle class="orbit-point green-fill" cx="497" cy="416" r="5" />
        </svg>`}
      </div>
      <div class="conversation-frame">
        <div class="preview-bar" aria-hidden="true"><span class="preview-dots"><i></i><i></i><i></i></span><span>Zillion</span><span class="preview-lock">◈</span></div>
        <img class="conversation-image image-light" src=${lightConversation} width="780" height="1260"
          alt=${t('Zillion demo: a private conversation with Maya about weekend plans.')} fetchpriority="high">
        <img class="conversation-image image-dark" src=${darkConversation} width="780" height="1260"
          alt=${t('Zillion demo: a private conversation with Maya about weekend plans.')} fetchpriority="high">
      </div>
      <span class="floating-key identity-key"><z-landing-icon props=${{ name: 'key' }} /><span>${t('Identity key')}<small>${t('YOUR NOSTR IDENTITY')}</small></span></span>
      <span class="floating-key content-key"><z-landing-icon props=${{ name: 'key' }} /><span>${t('Content key')}<small>${t('YOUR PRIVATE WORLD')}</small></span></span>
      <figcaption>${t('Familiar on the surface. Thoughtful underneath.')}</figcaption>
    </figure>
  </section>
`)
