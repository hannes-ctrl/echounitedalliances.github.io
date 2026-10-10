import { isConfigured, supabase } from './supabase'
import { useCached } from './cache'

/**
 * The network's headline figures -- how many carriers, how many airports.
 *
 * Both appear in copy across the site, and until now most of them had the
 * number typed in by hand. They said 590 against a roster of 602 for as long
 * as nobody looked, and the footer said 2,186 airports on the weekly scrape
 * that took the group to 2,180 -- because there is nothing about a hardcoded
 * number that ever tells you it has gone wrong.
 *
 * Each figure is one HEAD request with an exact count, so nothing but the
 * number crosses the wire, shared by every component that asks.
 *
 * It is kept across visits through lib/cache.ts: a returning visitor's first
 * paint carries the figure they were last shown rather than the fallback, and
 * a reload within ten minutes does not ask at all.
 *
 * The fallback is what renders before the count lands, and if it never does.
 * It will drift, and that is fine: it is a placeholder for the first paint,
 * not the answer. Anything reading these gets the real figure a moment later.
 * Last set from the 2 October 2026 scrape.
 */
type CountQuery = PromiseLike<{ count: number | null; error: unknown }>

const COUNT_OPTIONS = { fresh: 10 * 60 * 1000, persist: true }

function sharedCount(name: string, fallback: number, query: () => CountQuery) {
  const read = async () => {
    const { count, error } = await query()
    if (error || count == null) throw error ?? new Error(`no ${name} count`)
    return count
  }

  return function useSharedCount(): number {
    return useCached(isConfigured ? `count:${name}` : null, read, COUNT_OPTIONS) ?? fallback
  }
}

/** Carriers the alliance publishes. */
export const useCarrierCount = sharedCount('carriers', 639, () =>
  supabase.from('mv_airline_directory').select('uid', { count: 'exact', head: true }),
)

/**
 * Airports the network actually serves. The airports table holds more than
 * that on purpose -- an airport stays when the last route to it goes, because
 * an account's home airport or an old booking may still name it -- so the
 * figure counts the ones with a flight in or out, not the rows.
 */
export const useAirportCount = sharedCount('airports', 2180, () =>
  supabase
    .from('mv_airport_directory')
    .select('iata_code', { count: 'exact', head: true })
    .or('out_degree.gt.0,in_degree.gt.0'),
)

/**
 * Divisions in the group. It was eight for so long that "eight" was typed
 * into the copy in seven places, and Eos -- the ninth, opened 2 October 2026
 * -- meant finding every one of them by hand. Read like the figures above.
 */
export const useDivisionCount = sharedCount('divisions', 9, () =>
  supabase.from('divisions').select('division_code', { count: 'exact', head: true }),
)
