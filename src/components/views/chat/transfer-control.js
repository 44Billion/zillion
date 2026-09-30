import { f, useStore } from '#f'
import { t } from '#i18n/messages.js'
import '#f/components/f-svg.js'
import '#shared/icons/icon-x.js'
import '#shared/icons/icon-download.js'
import '#shared/icons/icon-refresh-alert.js'

// Both directions share actions, progress semantics and keyboard isolation.
f('z-media-transfer-control', ({ h, s, props }) => {
  const view = useStore({
    busy$ () { return ['pending', 'queued', 'starting', 'downloading'].includes(props.state$()?.status) },
    percent$ () {
      const state = props.state$()
      return state?.total > 0 ? Math.max(0, Math.min(100, Math.floor((state.completed || 0) * 100 / state.total))) : null
    },
    ring$ () {
      const percent = this.percent$()
      return s`<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><circle class="transfer-track" cx="24" cy="24" r="21" stroke="currentColor" stroke-width="2"></circle><circle class="transfer-arc" cx="24" cy="24" r="21" pathLength="100" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-dasharray="100" stroke-dashoffset=${100 - (percent ?? 25)} transform="rotate(-90 24 24)"></circle></svg>`
    },
    act (event) {
      event.preventDefault(); event.stopPropagation()
      if (this.busy$()) props.cancel?.()
      else props.start?.()
    }
  })
  const state = props.state$()
  if (!state || ['checking', 'complete'].includes(state.status)) return h``
  const busy = view.busy$()
  const overlay = props.overlay$()
  const label = busy ? t('Cancel') : state.status === 'error' ? t('Retry') : t('Download file')
  const progressLabel = props.upload$?.() ? t('Uploading file') : t('Downloading file')
  const percent = view.percent$()
  return h`<span class=${`media-transfer ${overlay ? 'transfer-overlay' : 'transfer-inline'}`} data-status=${state.status} onpointerdown=${event => event.stopPropagation()} onkeydown=${event => event.stopPropagation()}>
    <style>${`
      z-media-transfer-control .media-transfer {
        display: flex; align-items: center; gap: 8px; color: var(--z-accent-text);
        .transfer-button { position: relative; display: block; flex: none; }
        .transfer-action { position: relative; flex: none; display: grid; place-items: center; width: 44px; height: 44px; border: 0; padding: 10px; border-radius: 50%; background: var(--z-control); color: inherit; cursor: pointer; }
        .transfer-action:hover { filter: brightness(1.12); }
        .transfer-action:active { transform: scale(.94); }
        .transfer-action:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
        .transfer-ring { position: absolute; inset: 0; }
        .transfer-ring, .transfer-ring * { pointer-events: none !important; }
        .transfer-track { opacity: .2; }
        .transfer-arc { transition: stroke-dashoffset 180ms linear; }
        .transfer-ring.indeterminate { animation: media-transfer-spin 1.2s linear infinite; }
        .transfer-bar { flex: 1; min-width: 0; height: 4px; border: 0; border-radius: 4px; overflow: hidden; appearance: none; background: var(--z-control); accent-color: var(--z-accent-text); }
        .transfer-bar::-webkit-progress-bar { background: var(--z-control); border-radius: 4px; }
        .transfer-bar::-webkit-progress-value { background: currentColor; border-radius: 4px; transition: width 180ms linear; }
        .transfer-bar::-moz-progress-bar { background: currentColor; border-radius: 4px; }
        .transfer-percent { min-width: 4ch; color: var(--z-muted); font-size: 11rem; font-variant-numeric: tabular-nums; text-align: end; }
        &.transfer-inline { width: 100%; }
        &.transfer-overlay { position: absolute; inset: 0; z-index: 1; justify-content: center; pointer-events: none; color: white; }
        &.transfer-overlay .transfer-action { width: 48px; height: 48px; padding: 12px; background: rgb(0 0 0 / .48); backdrop-filter: blur(6px); box-shadow: 0 1px 4px rgb(0 0 0 / .18); pointer-events: auto; }
        @media (prefers-reduced-motion: reduce) {
          .transfer-ring.indeterminate { animation: none; }
          .transfer-arc, .transfer-bar::-webkit-progress-value { transition: none; }
        }
      }
      @keyframes media-transfer-spin { to { transform: rotate(360deg); } }
    `}</style>
    <span class="transfer-button"><button class="transfer-action" type="button" aria-label=${label} title=${label} onclick=${view.act}>
      ${busy ? h`<icon-x props=${{ size: '22px', weight: 'regular' }} />` : state.status === 'error' ? h`<icon-refresh-alert props=${{ size: '22px', weight: 'regular' }} />` : h`<icon-download props=${{ size: '22px', weight: 'regular' }} />`}
    </button>
      ${overlay && busy ? h`<span class=${`transfer-ring ${percent == null ? 'indeterminate' : ''}`} role="progressbar" aria-label=${progressLabel} aria-valuemin="0" aria-valuemax="100" aria-valuenow=${percent}><f-svg props=${{ svg$: view.ring$, size: '48px' }} /></span>` : null}
    </span>
    ${!overlay && busy ? h`<progress class="transfer-bar" max="100" value=${percent} aria-label=${progressLabel}></progress><span class="transfer-percent" aria-hidden="true">${percent == null ? '' : `${percent}%`}</span>` : null}
  </span>`
})
