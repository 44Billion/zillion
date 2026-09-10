import { f, toSignal, useStore, useTask } from '#f'
import { getT } from '#i18n/index.js'
import locales from './toast-locales.json'
import styles from './toast-styles.js'
import './icons/icon-x.js'
import './icons/icon-chevron-down.js'
import './icons/icon-circle-check.js'
import './icons/icon-alert-circle.js'
import './icons/icon-alert-triangle.js'
import './icons/icon-info-circle.js'

const t = getT(locales)
const TYPES = new Set(['success', 'error', 'warning', 'info'])
// Shared for the app's lifetime; the mounted host owns timers and teardown.
const session$ = toSignal(null)
let nextId = 0
const resolveText = value => String((typeof value === 'function' ? value() : value) ?? '')

export function show (entry) {
  const normalized = {
    type: TYPES.has(entry?.type) ? entry.type : 'info',
    message: entry?.message ?? '',
    longMessage: entry?.longMessage ?? ''
  }
  const previous = session$.peek()
  const current = previous && !previous.closing ? previous : { id: ++nextId, queue: [], revision: 0 }
  const queue = current.queue.filter(item => item.type !== normalized.type || item.message !== normalized.message || item.longMessage !== normalized.longMessage)
  queue.push(normalized)
  session$({ ...current, queue, index: queue.length - 1, revision: current.revision + 1, closing: false })
}

export function close () {
  const current = session$.peek()
  if (current && !current.closing) session$({ ...current, closing: true })
}

export const success = (message, longMessage) => show({ type: 'success', message, longMessage })
export const error = (message, longMessage) => show({ type: 'error', message, longMessage })
export const warning = (message, longMessage) => show({ type: 'warning', message, longMessage })
export const info = (message, longMessage) => show({ type: 'info', message, longMessage })

function navigate (offset) {
  const current = session$.peek()
  if (!current || current.closing) return
  const index = Math.max(0, Math.min(current.queue.length - 1, current.index + offset))
  if (index !== current.index) session$({ ...current, index, revision: current.revision + 1 })
}

f('z-toast', ({ h }) => {
  useTask(({ cleanup }) => cleanup(() => session$(null)))
  const session = session$()
  return h`
    <style>${styles}</style>
    ${session ? h({ key: session.id })`<z-toast-message props=${{ session$ }} />` : null}
  `
})

f('z-toast-message', ({ h, props }) => {
  const view = useStore(() => ({
    displayed$: props.session$().queue[props.session$().index],
    open$: false,
    swapping$: false,
    expanded$: false,
    pressed$: false,
    focused$: false,
    duration$: 4000,
    pause (event) {
      if (!event.target.closest('.toast-close')) this.pressed$(true)
    },
    release () {
      if (!this.pressed$()) return
      this.duration$(8000)
      this.pressed$(false)
    },
    focus (event) {
      if (!event.target.closest('.toast-close')) this.focused$(true)
    },
    blur (event) {
      if (event.currentTarget.contains(event.relatedTarget)) return
      this.duration$(8000)
      this.focused$(false)
    }
  }))

  useTask(({ cleanup }) => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => view.open$(true))
    })
    cleanup(() => cancelAnimationFrame(frame))
  }, { after: 'rendering' })

  useTask(({ track, cleanup }) => {
    const session = track(() => props.session$())
    if (!session) return
    const { queue, index, revision } = session
    if (revision === 1) return
    view.swapping$(true)
    let timer = setTimeout(() => {
      view.displayed$(queue[index])
      if (!queue[index].longMessage) view.expanded$(false)
      timer = setTimeout(() => view.swapping$(false), 20)
    }, 120)
    cleanup(() => clearTimeout(timer))
  })

  useTask(({ track, cleanup }) => {
    const { session, paused, duration } = track(() => ({
      session: props.session$(),
      paused: view.pressed$() || view.focused$(),
      duration: view.duration$()
    }))
    if (!session) return
    if (session.closing) {
      const timer = setTimeout(() => {
        if (session$.peek()?.id === session.id) session$(null)
      }, 250)
      cleanup(() => clearTimeout(timer))
    } else if (!paused) {
      const timer = setTimeout(close, duration)
      cleanup(() => clearTimeout(timer))
    }
  })

  const session = props.session$()
  if (!session) return
  const entry = view.displayed$()
  const message = resolveText(entry.message)
  const longMessage = resolveText(entry.longMessage)
  const iconProps = { size: '22px', weight: 'regular' }
  const icon = {
    success: () => h`<icon-circle-check props=${iconProps} />`,
    error: () => h`<icon-alert-circle props=${iconProps} />`,
    warning: () => h`<icon-alert-triangle props=${iconProps} />`,
    info: () => h`<icon-info-circle props=${iconProps} />`
  }[entry.type]()
  return h`
    <section class=${`toast-card ${session.closing ? 'is-closing' : view.open$() ? 'is-open' : ''} ${view.swapping$() ? 'is-swapping' : ''}`}
      data-type=${entry.type} ?data-has-long=${Boolean(longMessage)} ?data-expanded=${view.expanded$()} ?data-multi=${session.queue.length > 1}
      onpointerdown=${view.pause} onpointerup=${view.release} onpointercancel=${view.release} onpointerleave=${view.release}
      onfocusin=${view.focus} onfocusout=${view.blur}>
      <div class="toast-row">
        <span class="toast-icon toast-fader" aria-hidden="true">${icon}</span>
        <div class="toast-body toast-fader">
          <div class="toast-message" role="status" aria-live="polite" aria-atomic="true">${message}</div>
          <button type="button" class="toast-long" aria-label=${t('Toggle details')} aria-expanded=${String(view.expanded$())}
            aria-controls=${`toast-details-${session.id}`} onclick=${() => view.expanded$(value => !value)}>
            <span class="toast-long-preview">${longMessage}</span>
            <span class="toast-long-toggle" aria-hidden="true"><icon-chevron-down props=${{ size: '16px', weight: 'regular' }} /></span>
          </button>
          <div class="toast-long-text" id=${`toast-details-${session.id}`}>${longMessage}</div>
        </div>
        <button type="button" class="toast-btn toast-close" aria-label=${t('Close')} onclick=${close}>
          <span aria-hidden="true"><icon-x props=${{ size: '16px', weight: 'regular' }} /></span>
        </button>
      </div>
      <div class="toast-nav toast-fader">
        <button type="button" class="toast-btn toast-nav-prev" aria-label=${t('Previous')} ?disabled=${session.index === 0} onclick=${() => navigate(-1)}>
          <span aria-hidden="true"><icon-chevron-down props=${{ size: '16px', weight: 'regular' }} /></span>
        </button>
        <span class="toast-counter">${session.index + 1} / ${session.queue.length}</span>
        <button type="button" class="toast-btn toast-nav-next" aria-label=${t('Next')} ?disabled=${session.index === session.queue.length - 1} onclick=${() => navigate(1)}>
          <span aria-hidden="true"><icon-chevron-down props=${{ size: '16px', weight: 'regular' }} /></span>
        </button>
      </div>
    </section>
  `
})
