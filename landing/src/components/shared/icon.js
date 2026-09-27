import { f } from '#f'

f('z-landing-icon', ({ h, s, props }) => {
  const shapes = {
    arrow: s`<path d="M5 12h14M12 5l7 7-7 7" />`,
    northeast: s`<path d="M6 18 18 6M6 6h12v12" />`,
    code: s`<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16" />`,
    sun: s`<circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />`,
    moon: s`<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z" />`,
    system: s`<rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" />`,
    key: s`<circle cx="8" cy="8" r="5" /><path d="m11.5 11.5 9 9m-5-5 3-3m0 6 3-3" />`,
    alert: s`<path d="M12 3 2.5 20h19L12 3Zm0 6v5m0 3v.1" />`,
    group: s`<circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" />`,
    note: s`<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9M8 16l1-4L19 2l3 3L12 15l-4 1Z" />`,
    zap: s`<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />`
  }
  return h`${s`<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${shapes[props.name] || shapes.arrow}</svg>`}`
})
