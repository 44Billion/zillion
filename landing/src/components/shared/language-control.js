import { f, useStore, useTask } from '#f'
import { autoUpdate, computePosition, flip, offset, shift, size } from '@floating-ui/dom'
import { i18n, t, useLanguage } from '../../i18n/index.js'

const languages = [
  ['en', 'English', 'EN'], ['fr', 'Français', 'FR'], ['it', 'Italiano', 'IT'],
  ['de', 'Deutsch', 'DE'], ['es', 'Español', 'ES'], ['pt-BR', 'Português (Brasil)', 'PT'],
  ['ru', 'Русский', 'RU'], ['zh-CN', '简体中文', '简'], ['zh-TW', '繁體中文', '繁'],
  ['ja', '日本語', 'JA'], ['ko', '한국어', 'KO']
]
const choices = ['auto', ...languages.map(([code]) => code)]
const menuId = 'landing-language-menu'

f('z-language-control', ({ h }) => {
  const language = useLanguage()
  const view = useStore(() => ({
    rootRef$: null,
    anchorRef$: null,
    menuRef$: null,
    open$: false,
    position$: null,
    search: '',
    searchTime: 0,
    open () {
      this.search = ''
      this.searchTime = 0
      this.position$(null)
      this.open$(true)
    },
    close (restoreFocus = false) {
      this.open$(false)
      if (restoreFocus) this.anchorRef$()?.focus({ preventScroll: true })
    },
    select (code) {
      language.choose(code)
      this.close(true)
    },
    focusItem (index) {
      const items = this.menuRef$()?.querySelectorAll('[role="menuitemradio"]')
      const item = items?.[(index + choices.length) % choices.length]
      item?.focus({ preventScroll: true })
      item?.scrollIntoView({ block: 'nearest' })
    },
    key (event) {
      const items = [...this.menuRef$().querySelectorAll('[role="menuitemradio"]')]
      const index = items.indexOf(document.activeElement)
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        this.close(true)
      } else if (event.key === 'Tab') {
        // Let the browser move focus to the next header control without trapping it.
        this.close()
      } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        this.focusItem(event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : index + (event.key === 'ArrowDown' ? 1 : -1))
      } else if (event.key.length === 1 && event.key !== ' ' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.isComposing) {
        event.preventDefault()
        const now = Date.now()
        this.search = (now - this.searchTime < 700 ? this.search : '') + event.key.toLocaleLowerCase()
        this.searchTime = now
        const repeated = [...this.search].every(char => char === this.search[0])
        const query = repeated ? this.search[0] : this.search
        // Repeated letters cycle matching names; a prefix can keep the current item.
        const start = repeated ? index + 1 : Math.max(index, 0)
        for (let step = 0; step < items.length; step++) {
          const next = (start + step) % items.length
          if (items[next].textContent.trim().toLocaleLowerCase().startsWith(query)) {
            this.focusItem(next)
            break
          }
        }
      }
    }
  }))

  // Use the same public Floating UI primitives as the app, without its runtime.
  useTask(({ track, cleanup }) => {
    const { open, anchor, menu } = track(() => ({ open: view.open$(), anchor: view.anchorRef$(), menu: view.menuRef$() }))
    // Keep visibility and measurement in one effect; reactive tasks can run before template patches.
    if (menu) menu.hidden = !open
    if (!open || !anchor || !menu) return
    let active = true
    let version = 0
    let focused = false
    const update = async () => {
      const current = ++version
      const position = await computePosition(anchor, menu, {
        placement: 'bottom-end', strategy: 'fixed',
        middleware: [offset(9), flip({ padding: 12 }), shift({ padding: 12 }), size({
          padding: 12,
          apply ({ availableHeight, elements }) {
            elements.floating.style.maxHeight = `${Math.max(0, Math.min(440, availableHeight))}px`
          }
        })]
      })
      if (!active || current !== version) return
      view.position$({ x: position.x, y: position.y })
      if (!focused) {
        focused = true
        // Position first so focusing an option cannot scroll the page to the origin.
        menu.style.left = `${position.x}px`
        menu.style.top = `${position.y}px`
        menu.style.visibility = 'visible'
        view.focusItem(choices.indexOf(language.preference$()))
      }
    }
    const stop = autoUpdate(anchor, menu, update)
    const outside = event => {
      if (!view.rootRef$().contains(event.target)) view.close()
    }
    document.addEventListener('pointerdown', outside, true)
    cleanup(() => {
      active = false
      stop()
      document.removeEventListener('pointerdown', outside, true)
    })
  }, { after: 'rendering' })

  const current = languages.find(([code]) => code === i18n.getLocale())
  const position = view.position$()
  const entries = [['auto', t('Automatic (browser)')], ...languages]
  return h`
    <div class="language-control" ref=${view.rootRef$} @focusout=${event => {
      if (!event.currentTarget.contains(event.relatedTarget)) view.close()
    }}>
      <button class="language-trigger" type="button" ref=${view.anchorRef$}
        title=${t('Language')} aria-label=${`${t('Language')}: ${language.preference$() === 'auto' ? t('Automatic (browser)') + ' · ' : ''}${current[1]}`}
        aria-haspopup="menu" aria-expanded=${String(view.open$())} aria-controls=${menuId}
        onclick=${() => view.open$() ? view.close() : view.open()}
        onkeydown=${event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            view.open()
          }
        }}>
        <span class="language-code" aria-hidden="true">${current[2]} <span class="language-chevron">⌄</span></span>
      </button>
      <div class="language-menu" id=${menuId} role="menu" aria-label=${t('Language')} hidden
        ref=${view.menuRef$} onkeydown=${view.key}
        style=${{ left: `${position?.x ?? 0}px`, top: `${position?.y ?? 0}px`, visibility: position ? 'visible' : 'hidden' }}>
        ${entries.map(([code, name]) => h`<button class="language-option" type="button" role="menuitemradio"
          data-locale=${code} lang=${code === 'auto' ? i18n.getLocale() : code} tabindex="-1"
          aria-checked=${String(language.preference$() === code)} onclick=${() => view.select(code)}>
          <span>${name}</span><span class="language-check" aria-hidden="true">✓</span>
        </button>`)}
      </div>
    </div>
  `
})
