// Match Flame's maximum distance on either side of the current history entry.
export const MAX_ROUTE_DISTANCE = 4

export const routePageKey = route => route.url.pathname + route.url.search
export const routePageId = route => `${route.uid}:${routePageKey(route)}`

export function retainRoutePages (pages, route, uidCounter) {
  const key = routePageKey(route)
  const id = routePageId(route)
  const retained = pages.filter(page =>
    Math.abs(page.uid - route.uid) <= MAX_ROUTE_DISTANCE &&
    page.uid <= uidCounter &&
    (page.uid !== route.uid || page.id === id) &&
    (page.key !== key || page.id === id)
  )
  // An evicted entry must get fresh DOM/hooks if history returns to it later.
  if (!retained.some(page => page.id === id)) retained.push({ id, key, uid: route.uid, mountKey: crypto.randomUUID() })
  return retained.toSorted((a, b) => a.uid - b.uid)
}
