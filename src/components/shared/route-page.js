import { f, useClosestStore, useLocation } from '#f'
import { MAX_ROUTE_DISTANCE, routePageId } from '#helpers/route-pages.js'
import '#f/components/f-route.js'

export const useRoutePage = () => useClosestStore('z-route-page')

f('z-route-page', ({ h, props }) => {
  const location = useLocation()
  const page = useClosestStore('z-route-page', () => ({
    isActive$ () { return routePageId(location.route$()) === props.id },
    paths$ () { return this.isActive$() ? [location.route$().handler.path] : [] }
  }), { shouldCache: false })
  return h`
    <section class="route-page" data-route-id=${props.id} data-active=${String(page.isActive$())}
      ?inert=${!page.isActive$()} aria-hidden=${String(!page.isActive$())}>
      <div class="route-scroll" tabindex="-1">
        <f-route props=${{ paths$: page.paths$, maxVisibleDistance: MAX_ROUTE_DISTANCE }} />
      </div>
    </section>
  `
})
