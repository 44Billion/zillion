import { f } from '#f'
import '../shared/key-art.js'
import '../shared/benefit-art.js'

f('z-landing-privacy', ({ h }) => h`
  <section class="privacy shell" id="privacy" aria-labelledby="privacy-title">
    <div class="section-heading"><span class="eyebrow">BENEATH THE SURFACE</span><span class="section-line" aria-hidden="true"></span><span class="section-index" aria-hidden="true">01 — 04</span></div>
    <div class="keys-feature">
      <div class="keys-copy">
        <p class="feature-label"><span class="feature-number">01</span> DOUBLE DIFFIE–HELLMAN</p>
        <h2 id="privacy-title">Two keys.<br>One private conversation.</h2>
        <p>Your identity key alone isn’t enough to unlock messages protected by both keys.</p>
      </div>
      <z-key-art />
    </div>
    <div class="benefits">
      <article class="benefit">
        <z-benefit-art props=${{ name: 'deniability' }} />
        <p class="feature-label"><span class="feature-number">02</span> PLAUSIBLE DENIABILITY</p>
        <h3>Privacy beyond encryption.</h3>
        <p>Your messages don’t carry a signature others can use to prove you wrote them.</p>
      </article>
      <article class="benefit">
        <z-benefit-art props=${{ name: 'contacts' }} />
        <p class="feature-label"><span class="feature-number">03</span> PRIVATE CHANNELS</p>
        <h3>Your contacts.<br>Your conversations.</h3>
        <p>Knowing your public identity doesn’t give strangers a way into your private conversations.</p>
      </article>
      <article class="benefit">
        <z-benefit-art props=${{ name: 'sync' }} />
        <p class="feature-label"><span class="feature-number">04</span> ENCRYPTED HISTORY</p>
        <h3>Saved locally.<br>Synced privately.</h3>
        <p>Encrypted message history, kept on your devices and synced between those you link.</p>
      </article>
    </div>
    <details class="design-notes">
      <summary>Explore the design <span class="details-plus" aria-hidden="true">+</span></summary>
      <div class="design-notes-content">
        <p><strong>Two keys.</strong> Double-DH combines identity and content keys. The two-key protection applies when both are used; compatibility paths can differ. It does not protect an already compromised, unlocked device.</p>
        <p><strong>Deniability.</strong> Ordinary chat messages have no transferable cryptographic proof of authorship. Participants can still share screenshots or message content. MLS, used by <a href="https://github.com/marmot-protocol/marmot">Marmot</a>, authenticates messages with sender signatures; this is a different design tradeoff. See <a href="https://www.rfc-editor.org/rfc/rfc9420.html#section-6.1">MLS content authentication</a>.</p>
        <p><strong>Private channels.</strong> Channel keys restrict who can inject valid messages. This protects against outsiders, not abusive contacts or compromised participant keys. <a href="https://github.com/nostr-protocol/nips/blob/master/17.md#spam">NIP-17 describes the different spam challenge</a> of receiving envelopes from random sender keys.</p>
        <p><strong>Your history.</strong> The 44billion vault encrypts personal copies and synchronizes them between linked devices. Availability depends on storage and synchronization; device protection depends on the vault setup. This is not an unlimited backup guarantee.</p>
        <a class="text-link" href="https://github.com/44Billion/zillion/blob/main/docs/private-chats.md">Read the implementation notes <span aria-hidden="true">↗</span></a>
      </div>
    </details>
  </section>
`)
