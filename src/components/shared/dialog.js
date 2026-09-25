import { f, useStore, useTask, toSignal } from '#f'
import { t } from '#i18n/messages.js'
import { error } from './toast.js'

const request$ = toSignal(null)
export const showDialog = request => request$(request)

// Local adaptation of fui-dialog. The native dialog owns the top layer and
// keyboard focus trap; app tokens and responsive CSS replace its generic skin.
f('z-dialog', ({ h }) => {
  const view = useStore({ element$: null, busy$: false })
  const close = () => { if (!view.busy$()) request$(null) }
  useTask(({ track, cleanup }) => {
    const [element, request] = track(() => [view.element$(), request$()])
    if (!element || !request) return
    const previous = document.activeElement
    element.showModal()
    cleanup(() => { element.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) })
  }, { after: 'rendering' })
  const request = request$()
  return h`<dialog ref=${view.element$} aria-labelledby="z-dialog-title" aria-describedby="z-dialog-description" oncancel=${event => { event.preventDefault(); close() }} onclick=${event => { if (event.target === view.element$()) close() }}>
    <style>${`
      z-dialog dialog { padding: 0; border: 1px solid var(--z-border); border-radius: 20px; background: var(--z-surface); color: var(--z-text); width: min(480px, calc(100vw - 32px)); min-width: min(320px, calc(100vw - 32px)); max-height: calc(100svh - 32px); overflow: auto; }
      z-dialog dialog::backdrop { background: var(--z-shadow); backdrop-filter: blur(3px); }
      z-dialog .dialog-content { padding: 24px; }
      z-dialog h2 { margin: 0 0 16px; font-size: 20rem; }
      z-dialog p { font-size: 15rem; line-height: 1.6; }
      z-dialog .dialog-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 24px; }
      z-dialog button { min-height: 44px; padding: 10px 16px; border: 0; border-radius: 12px; background: var(--z-control); color: var(--z-text); font-size: 15rem; cursor: pointer; }
      z-dialog button:active { background: var(--z-pressed); }
      z-dialog button.destructive { color: var(--z-error); }
      @media (prefers-reduced-motion: no-preference) { z-dialog dialog[open] { animation: dialog-enter 160ms ease-out; } @keyframes dialog-enter { from { opacity: 0; transform: translateY(20px); } } }
      @media (max-width: 718px) { z-dialog dialog { margin: auto auto 0; width: min(480px, 100%); max-width: 100%; border-radius: 22px 22px 0 0; padding-bottom: env(safe-area-inset-bottom); } }
    `}</style>
    <div class="dialog-content"><h2 id="z-dialog-title">${request?.title?.() || ''}</h2><p id="z-dialog-description">${request?.description?.() || ''}</p>
      <div class="dialog-actions">${(request?.actions || []).map(action => h`<button type="button" class=${action.destructive ? 'destructive' : ''} ?disabled=${view.busy$()} onclick=${async () => {
        view.busy$(true)
        try { await action.run(); request$(null) } catch { error(() => t('Could not save message')) } finally { view.busy$(false) }
      }}>${action.label()}</button>`)}<button type="button" ?disabled=${view.busy$()} onclick=${close}>${t('Close')}</button></div>
    </div>
  </dialog>`
})
