import { f } from '#f'
import { i18n, t, useLanguage } from '../../i18n/index.js'

const languages = [
  ['en', 'English', 'EN'], ['fr', 'Français', 'FR'], ['it', 'Italiano', 'IT'],
  ['de', 'Deutsch', 'DE'], ['es', 'Español', 'ES'], ['pt-BR', 'Português (Brasil)', 'PT'],
  ['ru', 'Русский', 'RU'], ['zh-CN', '简体中文', '简'], ['zh-TW', '繁體中文', '繁'],
  ['ja', '日本語', 'JA'], ['ko', '한국어', 'KO']
]

f('z-language-control', ({ h }) => {
  const state = useLanguage()
  const locale = i18n.getLocale()
  // Update focus styling synchronously without rerendering the native menu during input.
  return h`
    <label class="language-control" title=${t('Language')}>
      <select aria-label=${t('Language')}
        onpointerdown=${event => event.currentTarget.classList.add('pointer-focus')}
        onblur=${event => event.currentTarget.classList.remove('pointer-focus')}
        onkeydown=${event => event.currentTarget.classList.remove('pointer-focus')} onchange=${event => state.choose(event.target.value)}>
        <option value="auto" .selected=${state.preference$() === 'auto'}>${t('Automatic (browser)')}</option>
        ${languages.map(([code, name]) => h`<option value=${code} lang=${code} .selected=${state.preference$() === code}>${name}</option>`)}
      </select>
      <span class="language-code" aria-hidden="true">${languages.find(([code]) => code === locale)[2]} <span class="language-chevron">⌄</span></span>
    </label>
  `
})
