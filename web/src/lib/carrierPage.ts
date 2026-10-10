import { supabase } from './supabase'
import { load, peek, put, type ReadOptions } from './cache'
import { rows } from './data'
import { accentOf } from './format'
import type {
  Airline,
  Arc,
  FleetRow,
  MemberSiteRow,
  NetworkNode,
  RoutePairRow,
  TimetableRow,
} from './types'

/**
 * Everything a carrier's page reads, and the order it is read in.
 *
 * The page used to wait three times in a row:
 *
 *   1. v_airline_profile, because it holds the uid every other read is keyed
 *      on. It also writes the carrier's paragraph on the way out, which reads
 *      its flights, its fleet and its legs -- a second or more for a big
 *      carrier, with a spinner in place of the whole page until it was back.
 *   2. Fleet, routes, website and idle routes behind one Promise.all. Fleet
 *      and routes answer in 150 ms; v_airline_idle_routes took 3.8 and 8.3
 *      seconds on Sofarobita (10 October 2026). So the two tables people came
 *      for waited on a footnote under one of them.
 *   3. The airports, for the map.
 *
 * What changed is the order, not the reads:
 *
 *   - The uid comes from the row the list already showed -- the card that was
 *     clicked is the same row the header draws -- or, on a deep link, from
 *     v_airline_directory_live, which is that row without the paragraph and
 *     answers in a tenth of the time.
 *   - Each read lands on its own. Nothing waits for a sibling.
 *   - The paragraph is asked for at the very start, as it always was, with
 *     only the quick reads beside it. The two heavy ones -- the timetable and
 *     the idle routes -- still start when it is back, also as they always did.
 *     That is deliberate. The database is small enough that two heavy reads at
 *     once are each much slower than either alone (the division summary took
 *     8 to 17 seconds beside one other heavy read on 10 October 2026, against
 *     1.6 alone), so starting them earlier made the paragraph and the
 *     timetable arrive later than before. In this order nothing does.
 *   - A carrier is kept for ten minutes, so Back is instant, and resting the
 *     pointer on a card starts the quick reads before the click.
 */

export type IdleRoute = { airport_a: string; airport_b: string; reason: string }
export type CarrierMap = { arcs: Arc[]; nodes: NetworkNode[] }

const KEPT: ReadOptions = { fresh: 10 * 60 * 1000 }

// Both parts come out of the address bar, where either can be made to hold a
// slash. Joined with one, "a/b" + "c" and "a" + "b/c" would be the same key.
const idOf = (code: string, slug: string) => JSON.stringify([code, slug])

/** Where each part of a carrier is held, for the page to watch with useHeld. */
export const carrierKeys = {
  /** The header row. Null once the database has said there is no such carrier. */
  row: (code: string, slug: string) => `carrier:row:${idOf(code, slug)}`,
  /** The same row from v_airline_profile: authoritative, and with the paragraph. */
  profile: (uid: string) => `carrier:profile:${uid}`,
  fleet: (uid: string) => `carrier:fleet:${uid}`,
  routes: (uid: string) => `carrier:routes:${uid}`,
  site: (uid: string) => `carrier:site:${uid}`,
  map: (uid: string) => `carrier:map:${uid}`,
  idle: (uid: string) => `carrier:idle:${uid}`,
  timetable: (uid: string, airport: string | null, pairWith: string | null) =>
    `carrier:timetable:${uid}:${airport ?? ''}:${pairWith ?? ''}`,
}

/**
 * v_airline_profile is a directory row plus two columns. This is the one that
 * can be worked out; the other is the paragraph, which is read separately.
 *
 * It has to be right rather than absent: the admin editor opens its
 * description box from description_is_custom, and a carrier whose written
 * profile was mistaken for a generated one would have it saved over as empty.
 */
const asProfile = (row: Airline): Airline => ({
  ...row,
  description_is_custom: row.description_md != null,
})

/**
 * A carrier row from any list, so its page can open on it without asking
 * again. A row already held is left alone: it is at least as new.
 */
export function rememberAirline(row: Airline): void {
  const key = carrierKeys.row(row.division_code, row.airline_slug)
  if (peek(key) === undefined) put(key, asProfile(row))
}

const AIRPORT_COLUMNS =
  'iata_code, city_name, country_code, latitude, longitude, weekly_departures, carriers, hub_for'

/** This carrier's own network: its airports' coordinates, and an arc per route. */
async function readMap(air: Airline, routeRows: RoutePairRow[]): Promise<CarrierMap> {
  const codes = Array.from(new Set(routeRows.flatMap((x) => [x.airport_a, x.airport_b]))).slice(0, 400)
  if (codes.length === 0) return { arcs: [], nodes: [] }
  const pts = await rows<NetworkNode[]>(
    supabase.from('mv_airport_directory').select(AIRPORT_COLUMNS).in('iata_code', codes),
  )
  const byCode = new Map((pts ?? []).map((p) => [p.iata_code, p]))
  const accent = accentOf(air)
  const arcs = routeRows
    .map((x) => {
      const o = byCode.get(x.airport_a)
      const d = byCode.get(x.airport_b)
      if (!o || !d || o.latitude == null || d.latitude == null) return null
      return {
        origin_iata: x.airport_a,
        destination_iata: x.airport_b,
        division_code: air.division_code,
        weekly_departures: x.departures_per_week,
        carriers: 1,
        origin_lat: o.latitude,
        origin_lon: o.longitude,
        dest_lat: d.latitude,
        dest_lon: d.longitude,
        accent_color: accent,
      } as Arc
    })
    .filter(Boolean) as Arc[]
  return { arcs, nodes: Array.from(byCode.values()).filter((p) => p.latitude != null) }
}

const readRow = (code: string, slug: string) =>
  rows<Airline | null>(
    supabase
      .from('v_airline_directory_live')
      .select('*')
      .eq('division_code', code)
      .eq('airline_slug', slug)
      .maybeSingle(),
  ).then((row) => (row ? asProfile(row) : null))

export const readProfile = (uid: string) =>
  rows<Airline | null>(supabase.from('v_airline_profile').select('*').eq('uid', uid).maybeSingle())

export const loadTimetable = (uid: string, airport: string | null, pairWith: string | null) =>
  load(
    carrierKeys.timetable(uid, airport, pairWith),
    () =>
      rows<TimetableRow[]>(
        supabase.rpc('airline_timetable', { p_uid: uid, p_airport: airport, p_pair_with: pairWith }),
      ).then((list) => list ?? []),
    KEPT,
  )

/** A whole-page open that is still under way, so asking twice starts it once. */
type Opening = { row: Promise<Airline | null>; turn: Promise<unknown> }
const opening = new Map<string, Opening>()

/** Fleet, routes, website and map for a carrier whose row is in. Settles with fleet and routes. */
function startQuickReads(air: Airline): Promise<unknown> {
  const uid = air.uid
  const fleet = load(
    carrierKeys.fleet(uid),
    () =>
      rows<FleetRow[]>(
        supabase
          .from('v_fleet')
          .select('aircraft_model, manufacturer, aircraft_count')
          .eq('airline_uid', uid)
          .order('aircraft_count', { ascending: false }),
      ).then((list) => list ?? []),
    KEPT,
  )
  // v_route_pairs, not v_routes: the latter is one row per direction, so the
  // table showed every route twice with half its departures each. Folding the
  // pair in SQL also means this top-400 is the right 400.
  const routes = load(
    carrierKeys.routes(uid),
    () =>
      rows<RoutePairRow[]>(
        supabase
          .from('v_route_pairs')
          .select(
            'airport_a, airport_b, departures_per_week, directions, sole_origin, fastest_minutes, cheapest_economy_usd',
          )
          .eq('airline_uid', uid)
          .order('departures_per_week', { ascending: false })
          .limit(400),
      ).then((list) => list ?? []),
    KEPT,
  )
  // Most carriers have no site of their own, so this returns no rows far more
  // often than it returns one.
  load(
    carrierKeys.site(uid),
    () =>
      rows<MemberSiteRow[]>(supabase.rpc('airline_site', { p_uid: uid })).then(
        (list) => (list ?? [])[0] ?? null,
      ),
    KEPT,
  ).catch(() => {})
  routes
    .then((routeRows) => load(carrierKeys.map(uid), () => readMap(air, routeRows), KEPT))
    .catch(() => {})
  return Promise.allSettled([fleet, routes])
}

/**
 * Start reading a carrier. Resolves with its row, or null if there is none.
 *
 * `whole` is the page asking: it also reads the paragraph, the idle routes and
 * the unfiltered timetable. Without it -- a pointer resting on a card -- only
 * the quick reads go out, which is the header, both tables and the map.
 */
export function openCarrier(code: string, slug: string, whole: boolean): Promise<Airline | null> {
  const id = idOf(code, slug)
  const under = whole ? opening.get(id) : undefined
  if (under) return under.row

  const rowKey = carrierKeys.row(code, slug)
  const known = peek<Airline | null>(rowKey) ?? null

  // The paragraph, at once. With the uid when a list has already shown this
  // carrier; by its address when nothing has, which is the read the page
  // always opened with -- and its answer is a whole row, so if it somehow
  // beats the directory's it draws the header too.
  let profile: Promise<unknown> = Promise.resolve()
  if (whole) {
    profile = known
      ? load(carrierKeys.profile(known.uid), () => readProfile(known.uid), KEPT)
      : rows<Airline | null>(
          supabase
            .from('v_airline_profile')
            .select('*')
            .eq('division_code', code)
            .eq('airline_slug', slug)
            .maybeSingle(),
        ).then((found) => {
          if (!found) return
          put(carrierKeys.profile(found.uid), found)
          if (peek(rowKey) === undefined) put(rowKey, found)
        })
  }

  const row = load(rowKey, () => readRow(code, slug), KEPT)
  const quick = row.then((air) => (air ? startQuickReads(air) : undefined))

  if (whole) {
    const turn = Promise.allSettled([profile, quick])
    opening.set(id, { row, turn })
    void turn.then(async () => {
      opening.delete(id)
      const air = await row.catch(() => null)
      if (!air) return
      load(
        carrierKeys.idle(air.uid),
        () =>
          rows<IdleRoute[]>(
            supabase
              .from('v_airline_idle_routes')
              .select('airport_a, airport_b, reason')
              .eq('airline_uid', air.uid)
              .order('airport_a')
              .order('airport_b'),
          ).then((list) => list ?? []),
        KEPT,
      ).catch(() => {})
      loadTimetable(air.uid, null, null).catch(() => {})
    })
  }
  return row
}

/**
 * Resolves when the heavy reads may start for a carrier being opened: its
 * paragraph is back and so are fleet and routes. At once if nothing is open.
 */
export const heavyTurn = (code: string, slug: string): Promise<unknown> =>
  opening.get(idOf(code, slug))?.turn ?? Promise.resolve()

/**
 * The quick reads for a carrier somebody looks about to open. Errors are
 * swallowed: the page asks again for itself if it is ever opened.
 */
export function prefetchCarrier(row: Airline): void {
  rememberAirline(row)
  openCarrier(row.division_code, row.airline_slug, false).catch(() => {})
}
