/**
 * Every page but Home, as the import that fetches it.
 *
 * In one place because three things need the same list: App.tsx turns each
 * into a lazy route, lib/warmup.ts fetches them all while the welcome plays,
 * and main.tsx fetches the one the address bar names before React has even
 * started -- so a deep link's page arrives alongside the first render rather
 * than after it.
 */
export const PAGES = {
  about: () => import('./About'),
  activities: () => import('./Activities'),
  divisions: () => import('./Divisions'),
  division: () => import('./Division'),
  airline: () => import('./Airline'),
  directory: () => import('./Directory'),
  airport: () => import('./Airport'),
  network: () => import('./Network'),
  search: () => import('./SearchResults'),
  book: () => import('./Book'),
  trips: () => import('./Trips'),
  resonance: () => import('./Resonance'),
  news: () => import('./News'),
  rtw: () => import('./RoundTheWorld'),
  policy: () => import('./Policy'),
}

export type PageName = keyof typeof PAGES
type PageModule<N extends PageName> = Awaited<ReturnType<(typeof PAGES)[N]>>

/** Pages whose file has arrived, so a route can draw one without waiting. */
const arrived: { [N in PageName]?: PageModule<N> } = {}

export const arrivedPage = <N extends PageName>(name: N): PageModule<N> | undefined => arrived[name]

/** Fetch a page's file. Asking again for one that is here, or coming, costs nothing. */
export function loadPage<N extends PageName>(name: N): Promise<PageModule<N>> {
  return (PAGES[name]() as Promise<PageModule<N>>).then((module) => {
    ;(arrived as Record<string, unknown>)[name] = module
    return module
  })
}

export const PAGE_NAMES = Object.keys(PAGES) as PageName[]

/** Which page a HashRouter address opens. Null for Home, and for no such page. */
export function pageFor(hash: string): PageName | null {
  const parts = hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean)
  switch (parts[0]) {
    case 'about':
      return 'about'
    case 'activities':
      return 'activities'
    case 'divisions':
      return 'divisions'
    case 'd':
      return parts.length >= 3 ? 'airline' : parts.length === 2 ? 'division' : null
    case 'airlines':
      return 'directory'
    case 'airports':
      return 'airport'
    case 'network':
      return 'network'
    case 'search':
      return 'search'
    case 'book':
      return 'book'
    case 'trips':
      return 'trips'
    case 'resonance':
      return 'resonance'
    case 'news':
      return 'news'
    case 'rtw':
      return 'rtw'
    case 'terms':
    case 'conduct':
    case 'privacy':
      return 'policy'
    default:
      return null
  }
}
