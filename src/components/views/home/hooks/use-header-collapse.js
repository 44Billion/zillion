import { useTask } from '#f'

export function useHeaderCollapse (view) {
  useTask(({ track, cleanup }) => {
    const [home, headerSpace, contacts] = track(() => [view.homeRef$(), view.headerSpaceRef$(), view.contactsRef$()])
    if (!home || !headerSpace || !contacts) return
    let threshold = 0
    let frame = 0
    let previous = -1
    const update = () => {
      frame = 0
      // One shared progress synchronizes the logo, padding and divider offset.
      const progress = Math.max(0, Math.min(1, (window.scrollY - threshold) / 96))
      if (progress === previous) return
      previous = progress
      home.style.setProperty('--home-header-collapse', String(progress))
    }
    const measure = () => {
      cancelAnimationFrame(frame)
      // The expanded flow slot keeps this threshold and scroll extent stable.
      threshold = contacts.getBoundingClientRect().bottom + window.scrollY - headerSpace.getBoundingClientRect().height
      update()
    }
    const schedule = () => { frame ||= requestAnimationFrame(update) }
    const observer = new ResizeObserver(measure)
    observer.observe(contacts)
    observer.observe(headerSpace)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', measure)
    measure()
    cleanup(() => {
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', measure)
      cancelAnimationFrame(frame)
      home.style.removeProperty('--home-header-collapse')
    })
  }, { after: 'rendering' })
}
