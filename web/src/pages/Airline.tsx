import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AdminAirlineEdit from '../components/AdminAirlineEdit'
import AdminMemberSiteEdit from '../components/AdminMemberSiteEdit'
import MemberSite from '../components/MemberSite'
import RouteMap from '../components/RouteMap'
import { Loading, Mark, NotConfigured } from '../components/ui'
import Pager, { usePaged } from '../components/Pager'
import { isConfigured, supabase } from '../lib/supabase'
import { load, put, useHeld } from '../lib/cache'
import { rows as read } from '../lib/data'
import {
  carrierKeys,
  heavyTurn,
  loadTimetable,
  openCarrier,
  readProfile,
  type CarrierMap,
  type IdleRoute,
} from '../lib/carrierPage'
import type {
  Airline,
  Arc,
  FleetRow,
  MemberSiteRow,
  NetworkNode,
  RoutePairRow,
  TimetableRow,
} from '../lib/types'
import { accentOf, duration, flag, num, usd } from '../lib/format'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

// One array each for "nothing yet", not a new one per render: usePaged and the
// map both take a changed array to mean changed rows.
const NO_FLEET: FleetRow[] = []
const NO_ROUTES: RoutePairRow[] = []
const NO_IDLE: IdleRoute[] = []
const NO_TIMETABLE: TimetableRow[] = []
const NO_MAP: CarrierMap = { arcs: [], nodes: [] }

type DivisionMap = { arcs: Arc[]; nodes: NetworkNode[] }

export default function AirlinePage() {
  const { code = '', slug = '' } = useParams()

  /**
   * The carrier arrives in pieces, each drawn as it lands -- lib/carrierPage.ts
   * says which, in what order, and why. This page starts the reading and then
   * only watches what is held: on a carrier opened a moment ago, or one whose
   * card the pointer rested on, every piece below is there on the first render.
   */
  const row = useHeld<Airline | null>(isConfigured ? carrierKeys.row(code, slug) : null)
  const uid = row?.uid ?? null
  // The same row from v_airline_profile, a second or so behind: it carries the
  // paragraph, and it is what an admin's edit is read back into.
  const profile = useHeld<Airline | null>(uid && carrierKeys.profile(uid))
  const a = profile ?? row ?? null
  const fleetHeld = useHeld<FleetRow[]>(uid && carrierKeys.fleet(uid))
  const routesHeld = useHeld<RoutePairRow[]>(uid && carrierKeys.routes(uid))
  const fleet = fleetHeld ?? NO_FLEET
  const routes = routesHeld ?? NO_ROUTES
  /** The member-built website covering this carrier, if there is one. */
  const site = useHeld<MemberSiteRow | null>(uid && carrierKeys.site(uid)) ?? null
  // City pairs it holds with nothing to sell: opened in the game with no
  // flights, or flights with no aircraft. The game counts them as routes.
  const idleRoutes = useHeld<IdleRoute[]>(uid && carrierKeys.idle(uid)) ?? NO_IDLE
  const { arcs, nodes } = useHeld<CarrierMap>(uid && carrierKeys.map(uid)) ?? NO_MAP
  /** The read for the row itself failed, which is not the same as no such carrier. */
  const [failed, setFailed] = useState<string | null>(null)
  const [ttAirport, setTtAirport] = useState<string>('')

  /**
   * The map answers two different questions and they need different data.
   *
   * "airline" is this carrier's own routes — what the page is about, and the
   * default. "division" is everything its division flies, which is a much
   * bigger set and comes from its own materialised view, so it is fetched
   * once on demand rather than on every page load.
   */
  const [mapMode, setMapMode] = useState<'airline' | 'division'>('airline')
  const [divLoading, setDivLoading] = useState(false)
  /** Which route the timetable is pinned to, if any. */
  const [ttRoute, setTtRoute] = useState<{ a: string; b: string } | null>(null)
  const timetableRef = useRef<HTMLElement>(null)

  const divisionCode = a?.division_code ?? null
  const divKey = mapMode === 'division' && divisionCode ? `division:arcs:${divisionCode}` : null
  const divMap = useHeld<DivisionMap>(divKey)
  const divArcs = divMap?.arcs ?? null
  const divNodes = divMap?.nodes ?? NO_MAP.nodes

  /**
   * The timetable, fetched for whatever is currently selected.
   *
   * It used to be fetched once, unfiltered, and narrowed in the browser. That
   * quietly lied: PostgREST caps a result at 1,000 rows and does not say so,
   * and this carrier files 2,790 services — so everything alphabetically after
   * HAN was missing, and asking for SGN's departures returned nothing from an
   * airport it serves 140 times a week.
   *
   * Filtering on the server instead means each scope is complete. Only the
   * unfiltered view can still hit the cap, and it now admits it.
   */
  const ttScopeAirport = ttRoute ? ttRoute.a : ttAirport || null
  const ttScopePair = ttRoute ? ttRoute.b : null
  const ttKey = uid ? carrierKeys.timetable(uid, ttScopeAirport, ttScopePair) : null
  /** A scope whose read failed, shown as empty rather than loading forever. */
  const [ttFailed, setTtFailed] = useState<string | null>(null)
  const timetable =
    useHeld<TimetableRow[]>(ttKey) ?? (ttKey !== null && ttFailed === ttKey ? NO_TIMETABLE : null)
  /** True when the unfiltered timetable came back at the server's row cap. */
  const ttCapped = !ttAirport && !ttRoute && timetable?.length === 1000

  // Up here with the other hooks on purpose. This component returns early
  // below -- not configured, no such carrier, still loading -- so a hook
  // called further down runs on some renders and not others, which is exactly
  // the "rendered more hooks than during the previous render" crash.
  const fleetPage = usePaged(fleet)
  const routePage = usePaged(routes)
  const timetablePage = usePaged(timetable ?? NO_TIMETABLE)

  const pageKey = JSON.stringify([code, slug])
  useEffect(() => {
    if (!isConfigured) return
    setMapMode('airline')
    setTtAirport('')
    setTtRoute(null)
    openCarrier(code, slug, true).catch(() => setFailed(pageKey))
    // pageKey is code and slug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, slug])

  useEffect(() => {
    if (!isConfigured || !uid || !ttKey) return
    // The unfiltered timetable is a heavy read and waits its turn behind the
    // paragraph (lib/carrierPage.ts); a scope the visitor just picked does not.
    const turn = ttScopeAirport ? Promise.resolve() : heavyTurn(code, slug)
    void turn
      .then(() => loadTimetable(uid, ttScopeAirport, ttScopePair))
      .catch(() => setTtFailed(ttKey))
    // ttKey is the uid and both scopes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttKey])

  // Fetched the first time Division mode is asked for, and kept. The whole
  // division is a much bigger draw than one carrier's routes and most visitors
  // never switch, so it does not belong in the page's initial load.
  useEffect(() => {
    if (!isConfigured || !divKey || !divisionCode) return
    let cancelled = false
    setDivLoading(true)
    void load<DivisionMap>(
      divKey,
      async () => {
        const list =
          (await read<Arc[]>(
            supabase.rpc('division_arcs', { p_division: divisionCode, p_limit: 700 }),
          )) ?? []
        const codes = Array.from(
          new Set(list.flatMap((x) => [x.origin_iata, x.destination_iata])),
        ).slice(0, 700)
        if (codes.length === 0) return { arcs: list, nodes: [] }
        const pts = await read<NetworkNode[]>(
          supabase
            .from('mv_airport_directory')
            .select('iata_code, city_name, country_code, latitude, longitude, weekly_departures, carriers, hub_for')
            .in('iata_code', codes),
        )
        return { arcs: list, nodes: (pts ?? []).filter((p) => p.latitude != null) }
      },
      { fresh: 30 * 60 * 1000 },
    )
      .catch(() => put<DivisionMap>(divKey, { arcs: [], nodes: [] }))
      .finally(() => {
        if (!cancelled) setDivLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [divKey, divisionCode])

  /** An admin's edit, read back from the profile view, becomes the carrier shown. */
  const setA = (updated: Airline) => put(carrierKeys.profile(updated.uid), updated)

  if (!isConfigured) return <NotConfigured />

  if (row === null || (row === undefined && failed === pageKey)) {
    return (
      <div className="mx-auto max-w-[1180px] px-5 py-24 text-center">
        <h1 className="display text-4xl">No such carrier</h1>
        <Link to="/airlines" className="mono mt-6 inline-block text-cyan">
          ← All carriers
        </Link>
      </div>
    )
  }
  if (!a) return <Loading label="Loading carrier" />

  const accent = accentOf(a)
  const named = a.airline_name?.trim()
  // Already scoped by the query above — a second pass here would only be a
  // chance for the two to disagree.
  const shown = timetable ?? []

  // Not memoised, and not a hook: everything below here sits after the early
  // returns above, where a hook would change the call order between renders.
  // It is a filter over at most 400 rows.
  const airportRoutes = !ttAirport
    ? []
    : routes
        .filter((r) => r.airport_a === ttAirport || r.airport_b === ttAirport)
        .map((r) => ({ ...r, other: r.airport_a === ttAirport ? r.airport_b : r.airport_a }))
        .sort((x, y) => y.departures_per_week - x.departures_per_week)

  const showFullTimetable = (other: string) => {
    setTtRoute({ a: ttAirport, b: other })
    // The timetable is a long way down the page; jumping to it is the point of
    // the button. A timeout rather than requestAnimationFrame, because this
    // only needs React to have committed the state, not a painted frame --
    // and rAF does not fire at all in a backgrounded tab, which would leave
    // the button silently doing nothing.
    let smooth = true
    try {
      smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    } catch {
      /* older browsers: scroll smoothly */
    }
    window.setTimeout(
      () =>
        timetableRef.current?.scrollIntoView({
          behavior: smooth ? 'smooth' : 'auto',
          block: 'start',
        }),
      0,
    )
  }

  return (
    <div>
      <section className="relative overflow-hidden border-b border-edge-soft">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(700px 320px at 80% 25%, ${accent}18, transparent 70%)` }}
        />
        <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-8 sm:px-5 sm:py-12 lg:grid-cols-[1.05fr_.95fr]">
          <div>
            <Link
              to={`/d/${a.division_code}`}
              className="mono text-[11px] uppercase tracking-[0.14em]"
              style={{ color: accent }}
            >
              ← {a.division_name} division
            </Link>

            <div className="mt-5 flex items-start gap-4">
              <Mark airline={a} size={62} />
              <div className="min-w-0">
                <h1 className="display text-[clamp(32px,4.6vw,52px)]">
                  {named || 'Unnamed carrier'}
                </h1>
                <div className="mono mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-ink-faint">
                  <span style={{ color: accent }}>{a.carrier_code}</span>
                  {a.airline_code && a.airline_code !== a.carrier_code && (
                    <span>in-game code {a.airline_code}</span>
                  )}
                  {a.airline_country && (
                    <span>{flag(a.airline_country)} {a.airline_country}</span>
                  )}
                  {a.is_division_leader && (
                    <span className="border border-edge px-2 py-0.5 uppercase tracking-[0.12em]">
                      Division leader
                    </span>
                  )}
                  {/* Renders nothing unless the signed-in account is an admin. */}
                  <AdminAirlineEdit airline={a} onSaved={setA} />
                </div>
              </div>
            </div>

            {a.description && (
              <p className="mt-5 max-w-[62ch] text-lg text-ink-dim">{a.description}</p>
            )}

            <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              {[
                ['Aircraft', num(a.fleet_size)],
                ['Types', num(a.aircraft_types)],
                ['Routes', num(a.routes)],
                ['Destinations', num(a.destinations)],
              ].map(([l, v]) => (
                <div key={l}>
                  <div className="mono text-2xl" style={{ color: accent }}>{v}</div>
                  <div className="text-[11px] uppercase tracking-[0.09em] text-ink-faint">{l}</div>
                </div>
              ))}
            </div>

            {a.hubs && a.hubs.length > 0 && (
              <div className="mt-7">
                <div className="eyebrow mb-2 text-ink-faint">Hubs</div>
                <div className="flex flex-wrap gap-2">
                  {a.hubs.map((h) => (
                    <Link
                      key={h}
                      to={`/airports/${h}`}
                      className="mono border px-2.5 py-1 text-[12px] transition-colors"
                      style={{ borderColor: `${accent}44`, color: accent }}
                    >
                      {h}
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Booking handoff: their own site if they have one, otherwise say so. */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {a.booking_url ? (
                <a
                  href={a.booking_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono px-5 py-2.5 text-[11px] uppercase tracking-[0.14em] text-[#0B0713]"
                  style={{ background: accent }}
                >
                  Book with {named ?? a.carrier_code} ↗
                </a>
              ) : site ? (
                <MemberSite site={site} accent={accent} />
              ) : (
                <span className="mono border border-edge px-5 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                  Contact airline for booking
                </span>
              )}
              {/* Only when no member site is shown: website_url mirrors that
                  same address, and a bare link to it would step around the
                  notice the button exists to give. */}
              {a.website_url && !site && (
                <a
                  href={a.website_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mono text-[11px] uppercase tracking-[0.14em] text-cyan"
                >
                  Website ↗
                </a>
              )}
              {/* Renders nothing unless the signed-in account is an admin. */}
              <AdminMemberSiteEdit
                airline={a}
                site={site}
                accent={accent}
                onSaved={(s) => {
                  put(carrierKeys.site(a.uid), s)
                  // website_url follows the website, so read the carrier back
                  // too: a removed website must not linger as a bare link.
                  void readProfile(a.uid)
                    .then((data) => {
                      if (data) setA(data)
                    })
                    .catch(() => {})
                }}
              />
            </div>
          </div>

          <div>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-2">
                {(['airline', 'division'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMapMode(m)
                      // The clicked airport belongs to whichever network was
                      // on screen; carrying it across modes would open a
                      // routes panel for an airport this carrier may not serve.
                      setTtAirport('')
                    }}
                    aria-pressed={mapMode === m}
                    className={`chip ${mapMode === m ? 'chip-on' : ''}`}
                  >
                    {m === 'airline' ? named || 'This carrier' : `${a.division_name} division`}
                  </button>
                ))}
              </div>
              {mapMode === 'division' && divLoading && (
                <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Drawing the division…
                </span>
              )}
            </div>

            <RouteMap
              arcs={mapMode === 'division' ? (divArcs ?? []) : arcs}
              nodes={mapMode === 'division' ? divNodes : nodes}
              className="w-full"
              zoomOnFocus
              focusedAirport={ttAirport || null}
              onPickAirport={(iata) => {
                setTtAirport(iata)
                setTtRoute(null)
              }}
            />
            <p className="mono mt-1 text-center text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              {mapMode === 'division'
                ? `${num((divArcs ?? []).length)} city pairs across ${a.division_name}`
                : `${num(routes.length)} routes · click an airport for its routes`}
            </p>

            {/* Airline mode only: the division network is not this carrier's,
                so a list of "its" routes from an airport would be a lie. */}
            {mapMode === 'airline' && ttAirport && (
              <div className="panel mt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-edge-soft px-4 py-3">
                  <h3 className="mono text-[11px] uppercase tracking-[0.14em] text-ink">
                    {airportRoutes.length > 0 ? (
                      <>
                        {num(airportRoutes.length)}{' '}
                        {airportRoutes.length === 1 ? 'route' : 'routes'} from{' '}
                        <span className="text-cyan">{ttAirport}</span>
                      </>
                    ) : (
                      <>
                        Nothing from <span className="text-cyan">{ttAirport}</span>
                      </>
                    )}
                  </h3>
                  <button
                    onClick={() => setTtAirport('')}
                    className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint hover:text-ink"
                  >
                    Clear
                  </button>
                </div>

                {airportRoutes.length === 0 ? (
                  <p className="px-4 py-5 text-sm text-ink-dim">
                    {named || 'This carrier'} does not serve {ttAirport}.
                  </p>
                ) : (
                  <ul className="max-h-[320px] overflow-auto">
                    {airportRoutes.map((r) => (
                      <li
                        key={`${r.airport_a}-${r.airport_b}`}
                        className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge-soft px-4 py-3 last:border-b-0"
                      >
                        <span className="mono text-sm text-ink">
                          {ttAirport}
                          <span className="text-ink-faint"> {r.directions === 1 ? '→' : '⇄'} </span>
                          <Link to={`/airports/${r.other}`} className="hover:text-cyan">
                            {r.other}
                          </Link>
                        </span>
                        <span className="mono text-[11px] text-ink-faint">
                          {r.departures_per_week}/wk · {duration(r.fastest_minutes)}
                          {r.cheapest_economy_usd != null && ` · from ${usd(r.cheapest_economy_usd)}`}
                        </span>
                        <button
                          onClick={() => showFullTimetable(r.other)}
                          className="mono ml-auto border border-edge px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] text-ink-dim transition-colors hover:border-accent hover:text-ink"
                        >
                          Show full timetable
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-[1180px] gap-10 px-4 py-8 sm:px-5 sm:py-14 lg:grid-cols-2">
        <div>
          <h2 className="display text-2xl">Fleet</h2>
          <p className="mt-1 text-ink-faint">
            {num(a.fleet_size)} aircraft across {num(a.aircraft_types)} types
          </p>
          <div className="panel mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-2 text-left">
                  <th className="mono px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint">Type</th>
                  <th className="mono px-4 py-2 text-right text-[10px] uppercase tracking-[0.1em] text-ink-faint">Count</th>
                </tr>
              </thead>
              <tbody>
                {fleetPage.slice.map((f) => (
                  <tr key={f.aircraft_model} className="border-t border-edge-soft">
                    <td className="px-4 py-2 text-ink">{f.aircraft_model}</td>
                    <td className="mono px-4 py-2 text-right text-ink-dim">{f.aircraft_count}</td>
                  </tr>
                ))}
                {fleet.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-ink-faint" colSpan={2}>
                      {fleetHeld ? 'No fleet recorded.' : 'Loading fleet…'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager paged={fleetPage} label="types" />
        </div>

        <div>
          <h2 className="display text-2xl">Busiest routes</h2>
          <p className="mt-1 text-ink-faint">By departures a week, both directions counted together</p>
          <div className="panel mt-4 max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0">
                <tr className="bg-surface-2 text-left">
                  <th className="mono px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint">Route</th>
                  <th className="mono px-4 py-2 text-right text-[10px] uppercase tracking-[0.1em] text-ink-faint">Weekly</th>
                  <th className="mono px-4 py-2 text-right text-[10px] uppercase tracking-[0.1em] text-ink-faint">Block</th>
                  <th className="mono px-4 py-2 text-right text-[10px] uppercase tracking-[0.1em] text-ink-faint">From</th>
                </tr>
              </thead>
              <tbody>
                {routePage.slice.map((r) => {
                  // Both ways is the normal case, and the arrow says so. A pair
                  // flown one way only is drawn in the direction it is flown.
                  const oneWay = r.directions === 1
                  const from = oneWay && r.sole_origin === r.airport_b ? r.airport_b : r.airport_a
                  const to = from === r.airport_a ? r.airport_b : r.airport_a
                  return (
                  <tr key={`${r.airport_a}-${r.airport_b}`} className="border-t border-edge-soft">
                    <td className="mono px-4 py-2 text-ink">
                      <Link to={`/airports/${from}`} className="hover:text-cyan">{from}</Link>
                      <span className="text-ink-faint" title={oneWay ? 'One way only' : 'Both directions'}>
                        {oneWay ? ' → ' : ' ⇄ '}
                      </span>
                      <Link to={`/airports/${to}`} className="hover:text-cyan">{to}</Link>
                    </td>
                    <td className="mono px-4 py-2 text-right text-ink-dim">{r.departures_per_week}</td>
                    <td className="mono px-4 py-2 text-right text-ink-dim">{duration(r.fastest_minutes)}</td>
                    <td className="mono px-4 py-2 text-right text-ink-dim">{usd(r.cheapest_economy_usd)}</td>
                  </tr>
                  )
                })}
                {routes.length === 0 && (
                  <tr>
                    <td className="px-4 py-6 text-ink-faint" colSpan={4}>
                      {routesHeld ? 'No routes filed.' : 'Loading routes…'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pager paged={routePage} label="routes" />
          {idleRoutes.length > 0 && (
            <div className="mt-5">
              <h3 className="mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                Not flying · {idleRoutes.length}
              </h3>
              <p className="mt-1 text-[13px] text-ink-faint">
                Routes {a?.airline_name} holds in the game with nothing scheduled to sell:
                opened with no flights yet, or flights with no aircraft assigned.
              </p>
              <div className="mono mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {idleRoutes.map((r) => (
                  <span
                    key={`${r.airport_a}-${r.airport_b}`}
                    className="border border-edge px-2 py-0.5 text-ink-dim"
                    title={r.reason === 'no_flights' ? 'Opened, no flights yet' : 'Flights with no aircraft assigned'}
                  >
                    {r.airport_a} ⇄ {r.airport_b}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section ref={timetableRef} className="mx-auto max-w-[1180px] px-5 pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="display text-2xl">Timetable</h2>
          <div className="mono flex flex-wrap items-center gap-2 text-[11px]">
            {ttRoute ? (
              <button
                onClick={() => setTtRoute(null)}
                className="border border-[color:var(--color-accent)] px-2.5 py-1 uppercase tracking-[0.12em] text-ink hover:bg-surface-2"
              >
                {ttRoute.a} ⇄ {ttRoute.b} ×
              </button>
            ) : (
              ttAirport && (
                <button
                  onClick={() => setTtAirport('')}
                  className="border border-edge px-2.5 py-1 uppercase tracking-[0.12em] text-ink-faint hover:text-ink"
                >
                  {ttAirport} ×
                </button>
              )
            )}
            <span className="text-ink-faint">
              {timetable ? `${num(shown.length)} services` : ''}
            </span>
          </div>
        </div>
        <p className="mt-1 text-ink-faint">
          {ttRoute
            ? `Every service between ${ttRoute.a} and ${ttRoute.b}, both directions.`
            : ttAirport
              ? `Every departure from ${ttAirport}. Times are local to it.`
              : 'Departure times are local to the departure airport. 0 = Monday.'}
        </p>

        {/* Saying "1,000 services" when there are 2,790 is worse than saying
            nothing; the way out is to pick an airport, so the notice says so. */}
        {ttCapped && (
          <p className="mono mt-3 border-l-2 border-l-[color:var(--color-warn)] bg-surface px-4 py-3 text-[12px] text-ink-dim">
            Showing the first 1,000 services — the server will not return more in
            one request. Click an airport on the map, or pick a route, for a
            complete list.
          </p>
        )}

        {timetable === null ? (
          <Loading />
        ) : shown.length === 0 ? (
          <p className="panel mt-4 p-8 text-center text-ink-dim">
            No scheduled services
            {ttRoute
              ? ` between ${ttRoute.a} and ${ttRoute.b}`
              : ttAirport
                ? ` from ${ttAirport}`
                : ''}
            .
          </p>
        ) : (
          <div className="panel mt-4 max-h-[560px] overflow-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="sticky top-0">
                <tr className="bg-surface-2 text-left">
                  {['Flight', 'Route', 'Departs', 'Arrives', 'Duration', 'Days', 'Aircraft', 'From'].map((h) => (
                    <th key={h} className="mono px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {timetablePage.slice.map((t, i) => (
                  <tr key={t.flight_designator + i} className="border-t border-edge-soft">
                    <td className="mono px-3 py-2 text-cyan">{t.flight_designator}</td>
                    <td className="mono px-3 py-2 text-ink">
                      {t.origin_iata} → {t.destination_iata}
                    </td>
                    <td className="mono px-3 py-2 text-ink-dim">{t.departure_time.slice(0, 5)}</td>
                    <td className="mono px-3 py-2 text-ink-dim">
                      {t.arrival_time.slice(0, 5)}
                      {t.arrival_days_after > 0 && (
                        <sup className="ml-0.5 text-cyan">+{t.arrival_days_after}</sup>
                      )}
                    </td>
                    <td className="mono px-3 py-2 text-ink-dim">{duration(t.duration_minutes)}</td>
                    <td className="mono px-3 py-2">
                      <span className="inline-flex gap-0.5">
                        {DAYS.map((d, di) => (
                          <span
                            // The labels are not unique -- Tuesday and
                            // Thursday are both "T", Saturday and Sunday both
                            // "S" -- so the day's position is the identity.
                            key={di}
                            title={d}
                            className="inline-block w-[15px] text-center text-[10px]"
                            style={{
                              color: t.days.includes(di) ? accent : 'var(--color-ink-faint)',
                              opacity: t.days.includes(di) ? 1 : 0.3,
                            }}
                          >
                            {d}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink-faint">{t.aircraft_model ?? '—'}</td>
                    <td className="mono px-3 py-2 text-right text-ink-dim">{usd(t.economy_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager paged={timetablePage} label="flights" />
          </div>
        )}
      </section>
    </div>
  )
}
