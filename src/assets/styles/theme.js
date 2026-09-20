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
  bgAvatarLoading: ['#e0e5df', '#303a34'],
  success: ['#147b45', '#6ad995'],
  error: ['#b42318', '#ff9189'],
  warning: ['#875500', '#efc466'],
  info: ['#1765a6', '#86c4ff'],
  nostr: ['#8654c5', '#c29afa'],
  lightning: ['#a87900', '#f2ca48'],
  bitcoin: ['#c66500', '#f9a347'],
  // The media canvas stays dark to frame photos in either theme.
  viewerCanvas: ['#101214', '#101214'],
  viewerText: ['#f5f6f7', '#f5f6f7'],
  viewerMuted: ['#b9bec4', '#b9bec4'],
  viewerControl: ['#282c30e6', '#282c30e6'],
  viewerPressed: ['#42484f', '#42484f'],
  viewerOverlay: ['#00000099', '#00000099'],
  viewerShadow: ['#00000055', '#00000055'],
  shadow: ['#00000033', '#00000066'],
  chatCanvas: ['#eaf0e8', '#111b16'],
  bubbleIncoming: ['#ffffff', '#26332d'],
  bubbleOutgoing: ['#d6edcf', '#235139'],
  bubbleQuote: ['#00000008', '#ffffff0d'],
  fileMedia: ['#e0eee7', '#223b30'],
  fileAudio: ['#ece5f3', '#352b43'],
  fileDocument: ['#e2ecf5', '#243747'],
  fileArchive: ['#f1e9d9', '#403727'],
  fileOther: ['#e9ede7', '#2a332d'],
  fileOverlay: ['#f7f8f5f2', '#1a201ef2'],
  chatOverlay: ['#f7f8f5ed', '#1a201eed']
}

const variableName = name => `--z-${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`
export const cssVars = {
  colors: Object.fromEntries(Object.keys(colors).map(name => [name, `var(${variableName(name)})`]))
}
export const themeCss = `:root {
  color-scheme: light dark;
  ${Object.entries(colors).map(([name, [light, dark]]) => `${variableName(name)}: light-dark(${light}, ${dark});`).join('\n  ')}
}`
