import { f, useStore, useTask } from '#f'

const storageKey = 'zillion:landing:theme'
const modes = ['system', 'light', 'dark']

f('z-theme-control', ({ h }) => {
  const state = useStore(() => ({
    mode$: modes.includes(document.documentElement.dataset.theme) ? document.documentElement.dataset.theme : 'system',
    next () { this.mode$(modes[(modes.indexOf(this.mode$()) + 1) % modes.length]) }
  }))
  useTask(({ track }) => {
    const mode = track(() => state.mode$())
    document.documentElement.dataset.theme = mode
    document.documentElement.style.removeProperty('color-scheme')
  })
  const changeTheme = () => {
    state.next()
    try { localStorage.setItem(storageKey, state.mode$()) } catch { /* Theme switching also works without storage. */ }
  }
  useTask(({ cleanup }) => {
    const onStorage = event => {
      if (event.key === storageKey || event.key === null) state.mode$(modes.includes(event.newValue) ? event.newValue : 'system')
    }
    window.addEventListener('storage', onStorage)
    cleanup(() => window.removeEventListener('storage', onStorage))
  })
  const next = modes[(modes.indexOf(state.mode$()) + 1) % modes.length]
  return h`
    <button class="theme-control" type="button" onclick=${changeTheme}
      aria-label=${`Theme: ${state.mode$()}. Switch to ${next} theme`} title=${`Theme: ${state.mode$()}. Switch to ${next}.`}>
      <span class="theme-icon theme-icon-system" hidden=${state.mode$() !== 'system'}><z-landing-icon props=${{ name: 'system' }} /></span>
      <span class="theme-icon theme-icon-light" hidden=${state.mode$() !== 'light'}><z-landing-icon props=${{ name: 'sun' }} /></span>
      <span class="theme-icon theme-icon-dark" hidden=${state.mode$() !== 'dark'}><z-landing-icon props=${{ name: 'moon' }} /></span>
      <span class="theme-label">${state.mode$() === 'system' ? 'Auto' : state.mode$() === 'light' ? 'Light' : 'Dark'}</span>
    </button>
  `
})
