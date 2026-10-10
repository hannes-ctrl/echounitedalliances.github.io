import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Advisory from '../components/Advisory'
import RouteMap from '../components/RouteMap'
import DepartureBoard from '../components/DepartureBoard'
import SearchPanel from '../components/SearchPanel'
import Join from '../components/Join'
import { AirlineCard, NotConfigured } from '../components/ui'
import EchoMark from '../components/EchoMark'
import { isConfigured, supabase } from '../lib/supabase'
import type { Airline, Arc, Division, NetworkNode } from '../lib/types'
import { accentOf, capitalise, num, spell } from '../lib/format'
import { useAirportCount, useCarrierCount, useDivisionCount } from '../lib/carriers'
import { useDivisions, useNetworkArcs, useNetworkNodes } from '../lib/data'

/**
 * Identity, then the divisions, then the search — in that order, because this
 * is a page about an alliance that happens to sell tickets, not a booking site
 * that happens to have members.
 */
/**
 * Six carriers from anywhere in the alliance, different on every visit. It
 * used to be the six most prominent, which meant the same six for everyone,
 * always. Six random places in the directory's own order, fetched one row
 * each, so nothing larger than the cards crosses the wire.
 */
async function spotlightPicks(total: number): Promise<Airline[]> {
  const n = Math.max(total, 1)
  const offsets = new Set<number>()
  while (offsets.size < Math.min(6, n)) offsets.add(Math.floor(Math.random() * n))
  const rows = await Promise.all(
    [...offsets].map((p_offset) =>
      supabase.rpc('search_airlines', { p_limit: 1, p_offset }).then(({ data }) =>
        ((data as Airline[]) ?? [])[0],
      ),
    ),
  )
  return rows.filter((a): a is Airline => Boolean(a))
}

/**
 * A visit is a page load, not a mount: coming back to Home from a carrier is
 * still the same visit, and should find the same six rather than wait for six
 * new ones. A draw that came back empty is not kept, so it is tried again.
 */
let spotlightDraw: Promise<Airline[]> | null = null
let spotlightDrawn: Airline[] = []

function drawSpotlight(total: number): Promise<Airline[]> {
  spotlightDraw ??= spotlightPicks(total).then(
    (picks) => {
      if (picks.length === 0) spotlightDraw = null
      spotlightDrawn = picks
      return picks
    },
    () => {
      spotlightDraw = null
      return []
    },
  )
  return spotlightDraw
}

const NO_ARCS: Arc[] = []
const NO_NODES: NetworkNode[] = []
const NO_DIVISIONS: Division[] = []

export default function Home() {
  // Each of these lands on its own. They used to share one Promise.all, so the
  // map, the division cards and the spotlight all waited for whichever of nine
  // requests was slowest -- which is always v_division_summary, by seconds.
  const divisions = useDivisions() ?? NO_DIVISIONS
  // Each division's busiest pairs first, so the map's cap never leaves a
  // division out -- Eos was, while its routes were all below the top 320.
  const arcs = useNetworkArcs(900) ?? NO_ARCS
  const nodes = useNetworkNodes(700) ?? NO_NODES
  const [spotlight, setSpotlight] = useState<Airline[]>(spotlightDrawn)
  const carrierCount = useCarrierCount()
  const divisionCount = useDivisionCount()
  const airportCount = useAirportCount()

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false
    void drawSpotlight(carrierCount).then((picks) => {
      if (!cancelled) setSpotlight(picks)
    })
    return () => {
      cancelled = true
    }
    // Drawn once, against whatever the count is when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const totals = divisions.reduce(
    (acc, d) => ({
      carriers: acc.carriers + Number(d.carriers),
      aircraft: acc.aircraft + Number(d.aircraft),
      routes: acc.routes + Number(d.routes),
    }),
    { carriers: 0, aircraft: 0, routes: 0 },
  )

  /**
   * The roster size, shown in three places in this page's copy and
   * previously typed into all three by hand. It said 590 against a real
   * roster of 602 for as long as nobody looked. It is a live figure now:
   * the division totals once they land, and the shared carrier count until
   * then, so the headline never reads "0 airlines" on first paint.
   */
  const carriers = totals.carriers || carrierCount

  if (!isConfigured) return <NotConfigured />

  return (
    <>
      {/* Renders nothing unless something is actually disrupting travel. */}
      <Advisory />

      {/* ---------- identity ----------
           One column, full width. This was a two-column grid with the board
           beside it, which squeezed the headline and the four headline figures
           into half the page and wrapped them badly. The figures are the point
           of the section; they get the whole measure. */}
      <section className="aurora relative overflow-hidden border-b border-edge-soft">
        <div className="mx-auto max-w-[1180px] px-4 pt-9 pb-10 sm:px-5 sm:pt-14 sm:pb-12 lg:pt-20">
          <div className="rise">
            <p className="eyebrow text-cyan">Echo United Alliances</p>
            <h1 className="display mt-3 text-[clamp(34px,8vw,96px)] sm:mt-4">
              {capitalise(spell(divisionCount))} divisions.{' '}
              <span style={{ color: 'var(--color-accent)' }}>{num(carriers)} airlines.</span>{' '}
              One network.
            </h1>
            <p className="mt-4 max-w-[62ch] text-ink-dim sm:mt-6 sm:text-lg">
              The largest alliance group in The Airline Simulator, drawn in full
              for the first time — every carrier, every hub, and every route
              they fly between them.
            </p>

            {/* the headline figures, on one uncramped row */}
            <div className="mt-7 grid grid-cols-2 gap-x-5 gap-y-5 sm:mt-10 sm:grid-cols-4 sm:gap-x-10 sm:gap-y-6">
              {[
                ['Carriers', totals.carriers],
                ['Aircraft', totals.aircraft],
                ['Routes', totals.routes],
                // Was the literal 2187, a week out of date the moment the
                // scrape moved. Now the airports the network actually serves.
                ['Airports', airportCount],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <div className="mono text-[clamp(24px,4vw,44px)] leading-none text-ink">
                    {num(value as number)}
                  </div>
                  <div className="mt-2 text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                    {label}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-2 sm:mt-10 sm:gap-3">
              <Link to="/divisions" className="btn btn-primary">
                Meet the divisions
              </Link>
              <Link to="/airlines" className="btn btn-ghost">
                All {num(carriers)} carriers
              </Link>
              <Join compact />
            </div>
          </div>
        </div>
      </section>

      {/* ---------- the board, directly under the figures ----------
           Full measure, and it keeps its own time: DepartureBoard refetches
           and re-renders on its own schedule so the rest of the page does
           not have to re-render with it. */}
      <section className="border-b border-edge-soft">
        <div className="mx-auto max-w-[1180px] px-4 py-7 sm:px-5 sm:py-10">
          <DepartureBoard />
        </div>
      </section>

      {/* ---------- the divisions ---------- */}
      <section className="mx-auto max-w-[1180px] px-4 py-9 sm:px-5 sm:py-16">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="display text-3xl">The divisions</h2>
          <Link to="/divisions" className="mono text-[11px] uppercase tracking-[0.14em] text-cyan">
            All {spell(divisionCount)} →
          </Link>
        </div>
        <p className="mt-2 max-w-[62ch] text-ink-dim">
          Each division is an alliance in its own right. Together they form Echo.
        </p>

        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {divisions.map((d, i) => {
            const accent = accentOf(d)
            return (
              <Link
                key={d.division_code}
                to={`/d/${d.division_code}`}
                className="panel lift rise group relative overflow-hidden p-5"
                style={{ animationDelay: `${i * 45}ms`, ['--card-accent' as string]: accent }}
              >
                <span
                  className="absolute inset-x-0 top-0 h-[2px]"
                  style={{ background: accent }}
                />
                <EchoMark height={15} color={accent} className="mb-3" />
                <div className="display text-2xl" style={{ color: accent }}>
                  {d.division_name}
                </div>
                <div className="mono mt-3 space-y-1 text-[11px] text-ink-dim">
                  <div>{num(d.carriers)} carriers</div>
                  <div>{num(d.aircraft)} aircraft</div>
                  <div>{num(d.routes)} routes</div>
                </div>
                {d.top_hubs && d.top_hubs.length > 0 && (
                  <div className="mono mt-3 truncate text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                    {d.top_hubs.slice(0, 4).join(' · ')}
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      </section>

      {/* ---------- the network, as a flat map ---------- */}
      <section className="mx-auto max-w-[1180px] px-5 pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="display text-3xl">Where Echo flies</h2>
          <Link to="/network" className="mono text-[11px] uppercase tracking-[0.14em] text-cyan">
            Explore the network →
          </Link>
        </div>
        <p className="mt-2 max-w-[62ch] text-ink-dim">
          The busiest city pairs the alliance operates, coloured by division.
        </p>
        <div className="panel mt-6 overflow-hidden">
          <RouteMap arcs={arcs} nodes={nodes} className="w-full" maxArcs={320} />
        </div>
      </section>

      {/* ---------- join: the expected path is site -> Discord ---------- */}
      <Join />

      {/* ---------- search ---------- */}
      <section className="border-y border-edge-soft bg-ground-2">
        <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-14">
          <h2 className="display text-3xl">Fly the whole alliance</h2>
          <p className="mt-2 max-w-[62ch] text-ink-dim">
            {num(carriers)} airlines, {spell(divisionCount)} divisions, one alliance — and one
            search across all of it. Fly them in any combination on a single
            booking reference.
          </p>
          <div className="mt-6">
            <SearchPanel />
          </div>
        </div>
      </section>

      {/* ---------- spotlight ---------- */}
      <section className="mx-auto max-w-[1180px] px-4 py-9 sm:px-5 sm:py-16">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="display text-3xl">Carriers in the alliance</h2>
          <Link to="/airlines" className="mono text-[11px] uppercase tracking-[0.14em] text-cyan">
            Browse all →
          </Link>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {spotlight.map((a) => (
            <AirlineCard key={a.uid} a={a} />
          ))}
        </div>
      </section>
    </>
  )
}
