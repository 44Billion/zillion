import { f } from '#f'

f('z-landing-horizon', ({ h }) => h`
  <section class="horizon" aria-labelledby="horizon-title">
    <div class="shell">
      <div class="horizon-heading">
        <div><p class="eyebrow">LOOKING AHEAD</p><h2 id="horizon-title">On the horizon<span aria-hidden="true">.</span></h2></div>
        <p>Planned features.<br>Not available yet.</p>
      </div>
      <div class="roadmap">
        <article class="roadmap-item roadmap-alert">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'alert' }} /></span>
          <h3>Identity misuse alerts</h3>
          <p>Get warned when your identity appears with an unrecognized content key.</p>
        </article>
        <article class="roadmap-item">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'group' }} /></span>
          <h3>Scalable group chats</h3>
          <p>Private conversations for larger circles.</p>
        </article>
        <article class="roadmap-item">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'note' }} /></span>
          <h3>Companion notes widget</h3>
          <p>Quick notes that arrive in your self-chat.</p>
        </article>
        <article class="roadmap-item">
          <span class="roadmap-icon"><z-landing-icon props=${{ name: 'zap' }} /></span>
          <h3>Zap to talk</h3>
          <p>Send sats to request someone’s attention.</p>
        </article>
      </div>
    </div>
  </section>
`)
