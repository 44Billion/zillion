import { f } from '#f'
import { t } from '../../i18n/index.js'

f('z-landing-horizon', ({ h }) => h`
  <section class="horizon" aria-labelledby="horizon-title">
    <div class="shell">
      <div class="horizon-heading">
        <div><p class="eyebrow">${t('LOOKING AHEAD')}</p><h2 id="horizon-title">${t('On the horizon')}<span aria-hidden="true">.</span></h2></div>
        <p>${t('Planned features.')}<br>${t('Not available yet.')}</p>
      </div>
      <div class="roadmap">
        <article class="roadmap-item roadmap-alert">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'alert' }} /></span>
          <h3>${t('Identity misuse alerts')}</h3>
          <p>${t('Get warned when your identity appears with an unrecognized content key.')}</p>
        </article>
        <article class="roadmap-item">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'group' }} /></span>
          <h3>${t('Scalable group chats')}</h3>
          <p>${t('Private conversations for larger circles.')}</p>
        </article>
        <article class="roadmap-item">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'note' }} /></span>
          <h3>${t('Companion notes widget')}</h3>
          <p>${t('Quick notes that arrive in your self-chat.')}</p>
        </article>
        <article class="roadmap-item">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'zap' }} /></span>
          <h3>${t('Zap to talk')}</h3>
          <p>${t('Send sats to request someone’s attention.')}</p>
        </article>
      </div>
    </div>
  </section>
`)
