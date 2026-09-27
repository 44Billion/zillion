import { f } from '#f'

f('z-benefit-art', ({ h, s, props }) => {
  const scenes = {
    deniability: s`
      <path class="scene-line" d="M102 58h77" stroke-dasharray="4 6" />
      <rect class="scene-soft" x="25" y="25" width="66" height="43" rx="15" />
      <path class="scene-soft" d="m37 66-4 11 19-10" />
      <rect class="scene-green" x="69" y="50" width="66" height="43" rx="15" />
      <path class="scene-green" d="m119 90 6 10-19-9" />
      <path class="scene-ink" d="M42 42h29M86 67h30m-30 9h20" />
      <rect class="scene-line" x="177" y="33" width="44" height="52" rx="9" stroke-dasharray="3 5" />
      <path class="scene-line" d="M191 51h16m-16 9h11" />
    `,
    contacts: s`
      <path class="scene-line" d="M24 37h84m-84 24h84m-84 24h84" stroke-dasharray="3 6" />
      <circle class="scene-dot-muted" cx="37" cy="37" r="5" />
      <circle class="scene-dot-muted" cx="58" cy="85" r="5" />
      <path class="scene-line" d="M112 17v88" />
      <rect class="scene-surface" x="102" y="45" width="20" height="32" rx="8" />
      <path class="scene-ink" d="M76 61h98m-7-6 7 6-7 6" />
      <rect class="scene-green" x="175" y="35" width="53" height="52" rx="18" />
      <path class="scene-ink" d="m189 61 9 9 16-19" />
    `,
    sync: s`
      <rect class="scene-soft" x="20" y="24" width="103" height="66" rx="9" />
      <path class="scene-line" d="M10 98h123M153 56h28" stroke-dasharray="3 5" />
      <rect class="scene-surface" x="30" y="33" width="82" height="47" rx="4" />
      <rect class="scene-green" x="55" y="43" width="33" height="26" rx="8" />
      <path class="scene-ink" d="M65 55h13m-13 6h8" />
      <rect class="scene-soft" x="183" y="15" width="47" height="86" rx="10" />
      <rect class="scene-surface" x="189" y="23" width="35" height="66" rx="6" />
      <rect class="scene-green" x="193" y="44" width="27" height="26" rx="8" />
      <path class="scene-ink" d="M200 55h12m-12 6h7" />
      <path class="scene-line" d="m153 50-6 6 6 6m20-12 6 6-6 6" />
    `
  }
  return h`<div class="benefit-art" aria-hidden="true">${s`<svg viewBox="0 0 250 120" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" focusable="false">${scenes[props.name]}</svg>`}</div>`
})
