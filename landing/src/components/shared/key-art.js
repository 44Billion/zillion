import { f } from '#f'
import { t } from '../../i18n/index.js'

f('z-key-art', ({ h, s }) => h`
  <div class="key-art" role="img" aria-label=${t('A purple identity key and a green content key join to protect one conversation. Both keys are needed.')}>
    ${s`<svg viewBox="0 0 440 272" fill="none" aria-hidden="true" focusable="false">
      <ellipse class="key-orbit" cx="220" cy="136" rx="184" ry="107" stroke-dasharray="3 7" />
      <g class="key-piece key-purple" transform="rotate(-38 170 103)">
        <circle class="key-shadow" cx="170" cy="110" r="39" stroke-width="23" />
        <path class="key-shadow" d="M170 151v79m0-37h28m-28 26h20" stroke-width="21" stroke-linecap="round" />
        <circle cx="170" cy="103" r="39" stroke-width="23" />
        <path d="M170 144v79m0-37h28m-28 26h20" stroke-width="21" stroke-linecap="round" />
        <path class="key-glint" d="M143 95a28 28 0 0 1 32-19" stroke-width="3" stroke-linecap="round" />
      </g>
      <g class="key-piece key-green" transform="rotate(38 270 103)">
        <circle class="key-shadow" cx="270" cy="110" r="39" stroke-width="23" />
        <path class="key-shadow" d="M270 151v79m0-37h-28m28 26h-20" stroke-width="21" stroke-linecap="round" />
        <circle cx="270" cy="103" r="39" stroke-width="23" />
        <path d="M270 144v79m0-37h-28m28 26h-20" stroke-width="21" stroke-linecap="round" />
        <path class="key-glint" d="M243 95a28 28 0 0 1 32-19" stroke-width="3" stroke-linecap="round" />
      </g>
      <rect class="key-center" x="199" y="125" width="42" height="42" rx="14" />
      <path class="key-check" d="m212 146 6 6 11-13" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>`}
    <div class="key-legend" aria-hidden="true"><span><i class="purple-fill"></i>${t('Identity key')}</span><span class="legend-plus">+</span><span><i class="green-fill"></i>${t('Content key')}</span></div>
  </div>
`)
