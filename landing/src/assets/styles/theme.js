// Landing-only light/dark pairs; the app and its runtime remain independent.
const colors = {
  canvas: ['#f7f8f4', '#121916'],
  surface: ['#ffffff', '#1b2420'],
  soft: ['#edf0e9', '#202c25'],
  text: ['#202d25', '#e8eee8'],
  muted: ['#627066', '#a6b2a8'],
  faint: ['#758175', '#92a294'],
  border: ['#dce3d9', '#334137'],
  green: ['#287048', '#91d3a8'],
  greenStrong: ['#205c3c', '#b0e4c2'],
  greenSoft: ['#dfeee1', '#244432'],
  purple: ['#8860ae', '#b995dd'],
  purpleSoft: ['#eee6f4', '#352a40'],
  amber: ['#946622', '#dbb577'],
  button: ['#dfd4ed', '#382b48'],
  onButton: ['#30223e', '#fbf8ff'],
  onButtonMuted: ['#584568', '#ddd1e9'],
  artLine: ['#c6d3c7', '#4b6050'],
  keyShadow: ['#1b302b22', '#00000044'],
  keyGlint: ['#ffffffaa', '#ffffff77'],
  shadow: ['#203a241c', '#00000055'],
  haloGreen: ['#b7cfad55', '#32634233'],
  haloPurple: ['#cfbade44', '#63428226']
}
const declarations = index => Object.entries(colors).map(([name, pair]) => `--l-${name}: ${pair[index]};`).join('\n')
export const themeCss = `
  :root { color-scheme: light; ${declarations(0)} }
  :root[data-theme="dark"] { color-scheme: dark; ${declarations(1)} }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]):not([data-theme="dark"]) { color-scheme: dark; ${declarations(1)} }
  }
`
