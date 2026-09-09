// Light/dark pairs follow the nappstore theme approach. Greens are adapted
// from WhatsApp's palette, with contrasting badge text in each color scheme.
// https://www.meta.com/design-at-meta/blog/whatsapp-user-interface-update/
export const colors = {
  canvas: ['#ecefea', '#111715'],
  surface: ['#f7f8f5', '#1a201e'],
  text: ['#242c28', '#e5ebe7'],
  muted: ['#657168', '#a2ada6'],
  subtle: ['#6a746d', '#95a199'],
  border: ['#e1e6df', '#303a34'],
  control: ['#e9ede7', '#2a332d'],
  pressed: ['#e3e9e1', '#313e35'],
  primary: ['#168447', '#21c063'],
  onPrimary: ['#f5fff8', '#082b18'],
  accentText: ['#147b45', '#6ad995'],
  bgAvatarLoading: ['#e0e5df', '#303a34']
}

const variableName = name => `--z-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
export const cssVars = {
  colors: Object.fromEntries(Object.keys(colors).map(name => [name, `var(${variableName(name)})`]))
}
export const themeCss = `:root {
  color-scheme: light dark;
  ${Object.entries(colors).map(([name, [light, dark]]) => `${variableName(name)}: light-dark(${light}, ${dark});`).join('\n  ')}
}`
