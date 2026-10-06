export const AVATAR_INITIAL_TIMEOUT_MS = 10000

// One initial visual budget per mounted identity, independent of shared IO/retries.
export function createAvatarPresentation ({ onChange, timeout = AVATAR_INITIAL_TIMEOUT_MS }) {
  let state
  let timer
  let closed = false
  const emit = () => { if (!closed) onChange({ ...state }) }
  const finish = () => {
    clearTimeout(timer)
    if (!state || closed) return
    state.initial = false
  }
  return {
    start (pk, seed) {
      clearTimeout(timer)
      state = { pk, picture: seed?.picture ?? null, initial: seed?.initial ?? !!pk, displayed: seed?.displayed ?? null }
      emit()
      if (state.initial && !closed) timer = setTimeout(() => { finish(); emit() }, timeout)
    },
    update ({ pk, picture, pending }) {
      if (closed || state?.pk !== pk) return
      state.picture = picture
      if (!picture && !pending) {
        state.displayed = null
        finish()
      }
      emit()
    },
    present ({ pk, url, src }) {
      if (closed || state?.pk !== pk || state.picture !== url || !src) return
      state.displayed = { url, src }
      finish()
      emit()
    },
    reject ({ pk, url }) {
      if (!closed && state?.pk === pk && state.picture === url) { finish(); emit() }
    },
    close () { closed = true; clearTimeout(timer) }
  }
}
