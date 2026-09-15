import { f, useStore, useTask } from '#f'
import { fileName, fitFileName } from '#helpers/attachment-presentation.js'
import { t } from '#i18n/messages.js'

f('z-file-name', ({ h, props }) => {
  const view = useStore({
    rootRef$: null, measureRef$: null, label$: '',
    name$ () { return fileName(props.file$(), t('unnamed-file')) }
  })
  useTask(({ track, cleanup }) => {
    const [root, measure, name] = track(() => [view.rootRef$(), view.measureRef$(), view.name$()])
    if (!root || !measure) return
    const widthOf = value => {
      measure.textContent = value
      return measure.getBoundingClientRect().width
    }
    const update = () => {
      const label = fitFileName(name, root.getBoundingClientRect().width, widthOf)
      // Restore the full-width probe so font changes remain observable. Neither
      // the visible label nor intermediate measurements affect the layout box.
      measure.textContent = name.full
      root.toggleAttribute('data-truncated', label !== name.full)
      view.label$(label)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(root)
    observer.observe(measure)
    cleanup(() => observer.disconnect())
  }, { after: 'rendering' })
  const name = view.name$()
  return h`<span class="file-name" ref=${view.rootRef$} title=${name.full} aria-label=${name.full} data-generic=${String(name.generic)}><style>${`
    z-file-name .file-name {
      position: relative; display: inline-block; min-width: 0; max-width: 100%; vertical-align: bottom; white-space: nowrap;
      &[data-generic="true"] { font-style: italic; }
      .file-layout { display: block; overflow: hidden; visibility: hidden; }
      .file-label { position: absolute; inset: 0; overflow: hidden; }
      .file-measure-box { position: absolute; inset: 0; overflow: hidden; visibility: hidden; pointer-events: none; }
      .file-measure { display: inline-block; width: max-content; }
    }
  `}</style><span class="file-layout" aria-hidden="true">${name.full}</span><span class="file-label">${view.label$()}</span><span class="file-measure-box" aria-hidden="true"><span class="file-measure" ref=${view.measureRef$}></span></span></span>`
})
