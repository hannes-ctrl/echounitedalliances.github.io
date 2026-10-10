import { useEffect } from 'react'
import { isConfigured, supabase } from './supabase'
import { forget, isFresh, load, peek, useCached, useHeld, type ReadOptions } from './cache'
import type { Airline, AirportRow, Arc, Division, NetworkNode } from './types'

/**
 * The reads more than one page makes, each made once and shared.
 *
 * See lib/cache.ts for what sharing means. This file is the list of questions:
 * what each is called, how it is asked, and how long its answer is good for.
 * A page asks by name -- useDivisions(), useNetworkArcs(900) -- and does not
 * know or care whether the answer came from the database, from the page
 * before it, or from the last visit.
 */

type Answer = PromiseLike<{ data: unknown; error: unknown }>

/** supabase-js answers an error rather than throwing one. Here it throws. */
export async function rows<T>(query: Answer): Promise<T> {
  const { data, error } = await query
  if (error) throw error
  return data as T
}

const MINUTE = 60 * 1000

// ---------------------------------------------------------------------------
// Divisions
// ---------------------------------------------------------------------------

/**
 * v_division_summary: nine rows, and the slowest thing the public site reads.
 * It counts every division's carriers, aircraft, routes and destinations on
 * the spot, and took 1.6 to 7.7 seconds on 10 October 2026. Seven pages show
 * it. So it is kept across visits, and index.html starts asking for it before
 * this script has even arrived (see earlyRead below and vite.config.ts).
 */
const DIVISIONS = 'divisions'
const DIVISIONS_OPTIONS: ReadOptions = { fresh: 10 * MINUTE, persist: true }

declare global {
  interface Window {
    /** Reads index.html started while the bundle was still downloading. */
    __echoEarly?: Record<string, Promise<unknown> | undefined>
  }
}

/** A read index.html already has in hand, usable once. */
function earlyRead<T>(name: string): Promise<T> | null {
  const early = typeof window === 'undefined' ? undefined : window.__echoEarly
  const started = early?.[name]
  if (!early || !started) return null
  early[name] = undefined
  return started as Promise<T>
}

const askDivisions = () =>
  rows<Division[]>(supabase.from('v_division_summary').select('*').order('sort_order'))

async function readDivisions(): Promise<Division[]> {
  const early = earlyRead<Division[]>(DIVISIONS)
  if (early) {
    try {
      const list = await early
      if (Array.isArray(list) && list.length > 0) return list
    } catch {
      /* the early attempt failed: ask the ordinary way */
    }
  }
  try {
    return await askDivisions()
  } catch {
    // A failed read is not an empty group. Treated as one, About reported
    // every leader as "not a division on record" while the weekly refresh held
    // the tables (2 October 2026). Wait, and try once more before giving up.
    await new Promise((r) => setTimeout(r, 4000))
    return askDivisions()
  }
}

export const loadDivisions = () => load(DIVISIONS, readDivisions, DIVISIONS_OPTIONS)

/** For after an admin moves a carrier: the held summary is no longer true. */
export const forgetDivisions = () => forget(DIVISIONS)

/** Every division in sort order. Undefined until the first answer. */
export function useDivisions(enabled = true): Division[] | undefined {
  return useCached(enabled && isConfigured ? DIVISIONS : null, readDivisions, DIVISIONS_OPTIONS)
}

/**
 * One division. Out of the shared list when that is held, which it is for
 * anyone arriving from Home or the divisions page; otherwise its own row is
 * read alone, because one row of that view answers in a third of the time the
 * nine do and a deep link should not wait for the other eight.
 *
 * Null means the database was asked and has no such division.
 */
export function useDivision(code: string): Division | null | undefined {
  const all = useHeld<Division[]>(isConfigured ? DIVISIONS : null, true)
  const alone = useCached<Division | null>(
    isConfigured && code && !all ? `division:${code}` : null,
    () =>
      rows<Division | null>(
        supabase.from('v_division_summary').select('*').eq('division_code', code).maybeSingle(),
      ),
    { fresh: 10 * MINUTE },
  )
  // A list kept from an earlier visit is shown as it is and checked behind
  // the page; load() asks nothing when it is recent enough.
  useEffect(() => {
    if (all) loadDivisions().catch(() => {})
  }, [all])
  if (all) return all.find((d) => d.division_code === code) ?? null
  return alone
}

// ---------------------------------------------------------------------------
// The network map
// ---------------------------------------------------------------------------

/**
 * Three pages draw the alliance map and each asked for its own cut of the same
 * two materialised views: 900 arcs for Home, 1,300 for the network page, 900
 * in a different order for a division. The network page's cut is the largest,
 * so once it is held the other two are taken out of it instead of asked for.
 * Until then each page asks for exactly what it always did -- a first visit to
 * Home does not pay for the bigger list.
 */
const ARCS_FULL = 1300
const NODES_FULL = 900
const MAP_OPTIONS: ReadOptions = { fresh: 30 * MINUTE }
const MAP_FULL_OPTIONS: ReadOptions = { fresh: 30 * MINUTE, persist: true }

export type ArcOrder = 'featured' | 'busiest'

const arcsKey = (limit: number, order: ArcOrder) => `arcs:${order}:${limit}`
const nodesKey = (limit: number) => `nodes:${limit}`

function askArcs(limit: number, order: ArcOrder): Promise<Arc[]> {
  let query = supabase.from('mv_network_arcs').select('*')
  // Each division's busiest pairs first, so a cap never leaves a division
  // out -- Eos was, while its routes were all below the top 320.
  if (order === 'featured') query = query.order('featured', { ascending: false })
  return rows<Arc[]>(query.order('weekly_departures', { ascending: false }).limit(limit)).then(
    (list) => list ?? [],
  )
}

/** A smaller cut taken from the full list, or null if it cannot be. */
function arcsFromFull(limit: number, order: ArcOrder): Arc[] | null {
  const full = peek<Arc[]>(arcsKey(ARCS_FULL, 'featured'), true)
  if (!full) return null
  // Same order: the first rows of the long list are the short list.
  if (order === 'featured') return full.slice(0, limit)
  // A different order can only be re-cut when the long list is every arc
  // there is, which it is whenever the view holds fewer than the cap.
  if (full.length >= ARCS_FULL) return null
  return [...full].sort((x, y) => y.weekly_departures - x.weekly_departures).slice(0, limit)
}

function readArcs(limit: number, order: ArcOrder): Promise<Arc[]> {
  if (limit === ARCS_FULL && order === 'featured') return askArcs(limit, order)
  const cut = arcsFromFull(limit, order)
  return cut ? Promise.resolve(cut) : askArcs(limit, order)
}

export function useNetworkArcs(limit: number, order: ArcOrder = 'featured'): Arc[] | undefined {
  const full = limit === ARCS_FULL && order === 'featured'
  return useCached(
    isConfigured ? arcsKey(limit, order) : null,
    () => readArcs(limit, order),
    full ? MAP_FULL_OPTIONS : MAP_OPTIONS,
  )
}

const askNodes = (limit: number) =>
  rows<NetworkNode[]>(supabase.from('mv_network_nodes').select('*').limit(limit)).then(
    (list) => list ?? [],
  )

function readNodes(limit: number): Promise<NetworkNode[]> {
  if (limit !== NODES_FULL) {
    const full = peek<NetworkNode[]>(nodesKey(NODES_FULL), true)
    if (full) return Promise.resolve(full.slice(0, limit))
  }
  return askNodes(limit)
}

export function useNetworkNodes(limit: number): NetworkNode[] | undefined {
  return useCached(
    isConfigured ? nodesKey(limit) : null,
    () => readNodes(limit),
    limit === NODES_FULL ? MAP_FULL_OPTIONS : MAP_OPTIONS,
  )
}

// ---------------------------------------------------------------------------
// Airports
// ---------------------------------------------------------------------------

export type Hub = { iata_code: string; city_name: string | null; airport_name: string | null }

const HUBS_OPTIONS: ReadOptions = { fresh: 30 * MINUTE, persist: true }
const readHubs = () =>
  rows<Hub[]>(
    supabase
      .from('mv_airport_directory')
      .select('iata_code, city_name, airport_name')
      .order('weekly_departures', { ascending: false })
      .limit(6),
  ).then((list) => list ?? [])

/** The six busiest airports, for the departure board's shortcuts. */
export function useHubs(): Hub[] | undefined {
  return useCached(isConfigured ? 'hubs' : null, readHubs, HUBS_OPTIONS)
}

const BUSIEST_OPTIONS: ReadOptions = { fresh: 30 * MINUTE }
const readBusiest = () =>
  rows<AirportRow[]>(
    supabase
      .from('mv_airport_directory')
      .select('*')
      .order('weekly_departures', { ascending: false })
      .limit(25),
  ).then((list) => list ?? [])

/** The 25 busiest airports, for the table beside the network map. */
export function useBusiestAirports(): AirportRow[] | undefined {
  return useCached(isConfigured ? 'airports:busiest' : null, readBusiest, BUSIEST_OPTIONS)
}

// ---------------------------------------------------------------------------
// Carrier lists
// ---------------------------------------------------------------------------

export type AirlineSearch = {
  q?: string
  division?: string
  country?: string
  limit: number
  offset?: number
}

const SEARCH_OPTIONS: ReadOptions = { fresh: 10 * MINUTE }

const searchKey = (s: AirlineSearch) =>
  `airlines:${JSON.stringify([s.q ?? '', s.division ?? '', s.country ?? '', s.limit, s.offset ?? 0])}`

const askAirlines = (s: AirlineSearch) =>
  rows<Airline[]>(
    supabase.rpc('search_airlines', {
      p_query: s.q || null,
      p_division: s.division || null,
      p_country: s.country || null,
      p_limit: s.limit,
      p_offset: s.offset ?? 0,
    }),
  ).then((list) => list ?? [])

/** search_airlines, with the answer kept so Back to a list does not reload it. */
export const searchAirlines = (s: AirlineSearch) =>
  load(searchKey(s), () => askAirlines(s), SEARCH_OPTIONS)

/** A list that is already held, to draw on the first render. */
export const heldAirlines = (s: AirlineSearch) => peek<Airline[]>(searchKey(s))

// ---------------------------------------------------------------------------
// Reading ahead
// ---------------------------------------------------------------------------

/** The directory's opening page, as Directory.tsx asks for it. */
export const DIRECTORY_PAGE = 60

/**
 * What the next page is likely to need, read while nobody is waiting.
 *
 * Called once the page in front of the visitor has everything it asked for.
 * One read at a time, lightest and likeliest first, so this never competes
 * with something the visitor is actually looking at -- the database is small
 * and two heavy reads at once are each slower than either alone.
 *
 * The division summary goes last because it is the heavy one. It is only
 * asked for here when the page on screen did not need it, and holding it is
 * what makes Home, Divisions and About open at once afterwards.
 */
export function readAhead(): (() => Promise<unknown>)[] {
  if (!isConfigured) return []
  const arcs = arcsKey(ARCS_FULL, 'featured')
  const nodes = nodesKey(NODES_FULL)
  return [
    () => load('hubs', readHubs, HUBS_OPTIONS),
    () =>
      isFresh(arcs, MAP_FULL_OPTIONS)
        ? Promise.resolve()
        : load(arcs, () => askArcs(ARCS_FULL, 'featured'), MAP_FULL_OPTIONS),
    () =>
      isFresh(nodes, MAP_FULL_OPTIONS)
        ? Promise.resolve()
        : load(nodes, () => askNodes(NODES_FULL), MAP_FULL_OPTIONS),
    () => searchAirlines({ limit: DIRECTORY_PAGE }),
    () => load('airports:busiest', readBusiest, BUSIEST_OPTIONS),
    () => loadDivisions(),
  ]
}
