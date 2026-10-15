// Let a restored list render before bulk per-contact work. Hidden documents
// still release promptly; explicit navigation can bypass this priority window.
function afterPaint (signal, rows) {
  return new Promise(resolve => {
    let frame
    let task
    let frames = 0
    let finished = false
    const finish = () => {
      finished = true
      clearTimeout(timer); clearTimeout(task)
      if (frame !== undefined) cancelAnimationFrame(frame)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 250)
    const next = () => {
      if (++frames < 3) frame = requestAnimationFrame(next)
      else task = setTimeout(finish, 0)
    }
    signal.addEventListener('abort', finish, { once: true })
    const schedule = () => {
      if (finished) return
      if (globalThis.requestAnimationFrame) frame = requestAnimationFrame(next)
      else task = setTimeout(finish, 0)
    }
    if (signal.aborted) finish()
    // Restored rows notify after their DOM commit; one more frame can paint it.
    else if (rows) rows.then(() => { frames = 2; schedule() })
    // Cold home/row components commit in successive frames.
    else schedule()
  })
}

export function createHomeStartup ({ prepare, paint = afterPaint, onError = () => {} }) {
  const pending = new Map()
  let controller = new AbortController()
  let preparing
  let releasing
  let rows
  let released = false
  const run = work => { try { Promise.resolve(work()).catch(onError) } catch (error) { onError(error) } }
  const start = () => {
    const signal = controller.signal
    return (preparing ??= Promise.resolve().then(() => signal.aborted ? null : prepare()).catch(onError))
  }
  function release () {
    released = true
    const work = [...pending.values()]
    pending.clear()
    for (const fn of work) run(fn)
  }
  return {
    start,
    defer (key, work) { if (released) run(work); else pending.set(key, work) },
    expectRows () { if (!released) rows ??= Promise.withResolvers() },
    presented () { rows?.resolve() },
    ready () {
      const signal = controller.signal
      return (releasing ??= start().then(() => signal.aborted ? null : paint(signal, rows?.promise)).then(() => { if (!signal.aborted) release() }).catch(error => { onError(error); if (!signal.aborted) release() }))
    },
    release,
    pause () {
      controller.abort(); controller = new AbortController()
      rows?.resolve(); rows = null
      pending.clear(); preparing = null; releasing = null; released = false
    }
  }
}
