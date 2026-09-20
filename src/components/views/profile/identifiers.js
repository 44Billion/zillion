import { f, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import { useRoutePage } from '#shared/route-page.js'
import { error } from '#shared/toast.js'
import { canShareText, shareText } from '#helpers/share-text.js'
import '#shared/icons/icon-copy.js'
import '#shared/icons/icon-share-2.js'
import '#shared/icons/icon-check.js'
import '#shared/icons/icon-user.js'
import '#shared/icons/icon-bolt.js'
import '#shared/icons/icon-currency-bitcoin.js'

const shorten = value => value.length > 36 ? `${value.slice(0, 16)}…${value.slice(-10)}` : value

f('z-profile-identifiers', ({ h, props }) => {
  const page = useRoutePage()
  const view = useStore(() => ({
    copied$: '', busy$: false, alive: true,
    rows$ () {
      const details = props.details$()
      return [
        { id: 'nostr', kind: details.nip05 ? 'nip05' : 'npub', label: details.nip05 ? 'NIP-05' : 'npub', value: details.identifier, display: details.identifierLabel },
        ...(details.nip05 && details.npub ? [{ id: 'npub', kind: 'npub', label: 'npub', value: details.npub }] : []),
        ...(details.lightning ? [{ id: 'lightning', kind: 'lightning', label: t('Lightning address'), value: details.lightning.value }] : []),
        ...(details.bitcoin ? [{ id: 'bitcoin', kind: 'bitcoin', label: t('Bitcoin address'), value: details.bitcoin }] : [])
      ]
    },
    async share (row) {
      if (!row.value || this.busy$()) return
      this.busy$(true)
      try {
        const result = await shareText(row.value)
        if (this.alive && page.isActive$() && result === 'copied') this.copied$(`${row.id}:${row.value}`)
      } catch {
        if (this.alive && page.isActive$()) error(() => t('Could not copy identifier'))
      } finally {
        if (this.alive) this.busy$(false)
      }
    }
  }))
  useTask(({ cleanup }) => cleanup(() => { view.alive = false }))
  useTask(({ track, cleanup }) => {
    if (!track(() => view.copied$())) return
    const timer = setTimeout(() => view.copied$(''), 1600)
    cleanup(() => clearTimeout(timer))
  })
  useTask(({ track }) => { if (!track(() => page.isActive$())) view.copied$('') })
  return h`
    <div class="profile-identifiers">
      <style>${`
        z-profile-identifiers .profile-identifiers {
          max-width: 420px; margin: 12px auto 0; text-align: start;
          .profile-identifier { display: grid; grid-template-columns: 24px minmax(0, 1fr) 44px; align-items: center; gap: 8px; min-height: 44px; }
          .identifier-icon { display: grid; place-items: center; width: 24px; height: 24px; }
          [data-kind=nip05] .identifier-icon { color: var(--z-accent-text); }
          [data-kind=npub] .identifier-icon { color: var(--z-nostr); }
          [data-kind=lightning] .identifier-icon { color: var(--z-lightning); }
          [data-kind=bitcoin] .identifier-icon { color: var(--z-bitcoin); }
          .identifier-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14rem; color: var(--z-muted); }
          .profile-share { display: grid; place-items: center; width: 44px; height: 44px; padding: 0;
            border: 0; border-radius: 50%; background: transparent; color: var(--z-muted); }
          .profile-share:active:not(:disabled) { background: var(--z-pressed); }
          .profile-share:disabled { opacity: .5; }
          .profile-share[data-copied=true] { color: var(--z-success); }
        }
      `}</style>
      ${view.rows$().map(row => {
        const copied = !!row.value && view.copied$() === `${row.id}:${row.value}`
        const share = !!row.value && canShareText(row.value)
        return h({ key: row.id })`
          <div class="profile-identifier" data-identifier=${row.id} data-kind=${row.kind}>
            <span class="identifier-icon" aria-hidden="true">${row.kind === 'lightning' ? h`<icon-bolt props=${{ size: '21px', weight: 'regular' }} />` : row.kind === 'bitcoin' ? h`<icon-currency-bitcoin props=${{ size: '22px', weight: 'regular' }} />` : h`<icon-user props=${{ size: '21px', weight: 'regular' }} />`}</span>
            <span class="identifier-text" title=${row.value} aria-label=${`${row.label}: ${row.value || t('Identifier unavailable')}`}>${row.value ? row.display || shorten(row.value) : t('Identifier unavailable')}</span>
            <button class="profile-share" type="button" ?disabled=${!row.value || view.busy$()} data-copied=${String(copied)} aria-label=${t(copied ? 'Copied' : share ? 'Share {{identifier}}' : 'Copy {{identifier}}', { identifier: row.label })} onclick=${() => view.share(row)}>
              ${copied ? h`<icon-check props=${{ size: '22px', weight: 'regular' }} />` : share ? h`<icon-share-2 props=${{ size: '20px' }} />` : h`<icon-copy props=${{ size: '20px' }} />`}
            </button>
          </div>`
      })}
    </div>
  `
})
