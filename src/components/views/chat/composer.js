import { f, useStore, useTask } from '#f'
import { t } from '#i18n/messages.js'
import '#shared/icons/icon-paperclip.js'
import '#shared/icons/icon-camera.js'
import '#shared/icons/icon-send-2.js'

f('z-chat-composer', ({ h }) => {
  const view = useStore({ text$: '', fieldRef$: null, inputRef$: null })
  useTask(({ track, cleanup }) => {
    const { input, field } = track(() => ({ input: view.inputRef$(), field: view.fieldRef$(), text: view.text$() }))
    if (!input || !field) return
    const resize = () => {
      const style = getComputedStyle(input)
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const max = parseFloat(style.lineHeight) * 5 + padding
      input.style.height = '0px'
      input.style.height = `${Math.min(input.scrollHeight, max)}px`
      input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden'
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(field)
    cleanup(() => observer.disconnect())
  }, { after: 'rendering' })
  const hasText = view.text$().length > 0
  const showMediaControls = FUTURE_FEATURES_ENABLED && !hasText
  return h`
    <footer class="chat-composer">
      <style>${`
        z-chat-composer .chat-composer {
          display: flex; align-items: end; gap: 8px;
          padding: 8px max(8px, env(safe-area-inset-right)) max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left));
          background: var(--z-chat-canvas); flex: none;
          .composer-field { flex: 1; min-width: 0; display: flex; align-items: end; border-radius: 24px; background: var(--z-surface); border: 1px solid var(--z-border); }
          .composer-field:focus-within { outline: 2px solid var(--z-accent-text); outline-offset: -2px; }
          textarea {
            display: block; flex: 1; min-width: 0; width: 100%; height: 44px;
            margin: 0; border: 0; resize: none; padding: 10px 14px; border-radius: 24px;
            background: transparent; color: var(--z-text); font: inherit; font-size: 16rem; line-height: 1.5;
          }
          textarea::placeholder { color: var(--z-muted); opacity: 1; }
          textarea:focus { outline: none; }
          button { display: grid; place-items: center; flex: none; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; }
          .attach { color: var(--z-muted); background: transparent; }
          .compose-action { background: var(--z-primary); color: var(--z-on-primary); }
          button:active { filter: brightness(.94); }
        }
      `}</style>
      <div class="composer-field" ref=${view.fieldRef$}>
        <textarea ref=${view.inputRef$} rows="1" placeholder=${t('Message')} aria-label=${t('Message')}
          enterkeyhint="enter" .value=${view.text$()} oninput=${event => view.text$(event.target.value)}></textarea>
        ${showMediaControls ? h`<button class="attach" type="button" aria-label=${t('Attach file')} aria-disabled="true"><icon-paperclip props=${{ size: '24px', weight: 'light' }} /></button>` : null}
      </div>
      <button class="compose-action" type="button" aria-label=${t(showMediaControls ? 'Camera' : 'Send message')} aria-disabled="true">
        ${showMediaControls ? h`<icon-camera props=${{ size: '24px', weight: 'regular' }} />` : h`<icon-send-2 props=${{ size: '24px', weight: 'regular' }} />`}
      </button>
    </footer>
  `
})
