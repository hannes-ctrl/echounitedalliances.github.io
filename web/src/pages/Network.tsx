import { useState } from 'react'
import { Link } from 'react-router-dom'
import RouteMap from '../components/RouteMap'
import { Loading, NotConfigured } from '../components/ui'
import Pager, { usePaged } from '../components/Pager'
import { isConfigured, supabase } from '../lib/supabase'
import { useBusiestAirports, useDivisions, useNetworkArcs, useNetworkNodes } from '../lib/data'
import type { AirportRoute, AirportRow, Arc, Division, NetworkNode } from '../lib/types'
import { accentOf, num } from '../lib/format'

const NO_ARCS: Arc[] = []
const NO_NODES: NetworkNode[] = []
const NO_DIVISIONS: Division[] = []
const NO_AIRPORTS: AirportRow[] = []

/** The whole alliance drawn at once, with the busiest airports beside it. */
export default function NetworkPage() {
  // Four reads, each drawn when it lands. They used to share one Promise.all,
  // so the map -- two quick materialised views -- stayed behind a spinner
  // until v_division_summary had answered, which it does seconds later.
  const arcsHeld = useNetworkArcs(1300)
  const nodesHeld = useNetworkNodes(900)
  const arcs = arcsHeld ?? NO_ARCS
  const nodes = nodesHeld ?? NO_NODES
  const divisions = useDivisions() ?? NO_DIVISIONS
  const busiest = useBusiestAirports() ?? NO_AIRPORTS
  const busiestPage = usePaged(busiest)
  const [focus, setFocus] = useState<string | null>(null)
  const ready = arcsHeld !== undefined && nodesHeld !== undefined
  // When an airport is picked the map zooms to it and shows only what it
  // reaches, each route coloured by whichever division flies it most.
  const [pinned, setPinned] = useState<string | null>(null)
  const [fanned, setFanned] = useState<Arc[] | null>(null)

  const pickAirport = async (iata: string) => {
    setPinned(iata)
    setFanned(null)
    const { data } = await supabase.rpc('airport_routes', { p_iata: iata })
    setFanned(
      ((data as AirportRoute[]) ?? []).map((r) => ({
        origin_iata: r.origin_iata,
        destination_iata: r.destination_iata,
        division_code: r.division_code,
        weekly_departures: Number(r.weekly_departures),
        carriers: Number(r.carriers),
        origin_lat: r.origin_lat,
        origin_lon: r.origin_lon,
        dest_lat: r.dest_lat,
        dest_lon: r.dest_lon,
        accent_color: r.accent_color,
      })),
    )
  }

  if (!isConfigured) return <NotConfigured />

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-12">
      <p className="eyebrow text-cyan">Network</p>
      <h1 className="display mt-3 text-[clamp(36px,5vw,58px)]">The alliance, drawn</h1>
      <p className="mt-4 max-w-[64ch] text-lg text-ink-dim">
        The 1,200 busiest city pairs Echo flies, coloured by the division that
        operates them. Pick a division to light only its routes, or click any
        airport to zoom in on what it reaches.
      </p>

      {pinned && (
        <div className="panel mt-6 flex flex-wrap items-center gap-4 p-4">
          <div>
            <div className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">
              Fanned out from
            </div>
            <div className="mono text-xl text-cyan">{pinned}</div>
          </div>
          <div className="mono text-[12px] text-ink-dim">
            {fanned === null ? 'loading…' : `${fanned.length} destinations`}
          </div>
          <div className="ml-auto flex gap-2">
            <Link
              to={`/airports/${pinned}`}
              className="mono border border-edge px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-ink hover:border-accent"
            >
              Carriers here
            </Link>
            <button
              onClick={() => { setPinned(null); setFanned(null) }}
              className="mono border border-edge px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-ink-faint hover:text-ink"
            >
              Show whole network
            </button>
          </div>
        </div>
      )}

      <div className="mono mt-7 flex flex-wrap gap-1.5 text-[11px] uppercase tracking-[0.1em]">
        <button
          onClick={() => setFocus(null)}
          className={`border px-2.5 py-1 transition-colors ${
            focus === null
              ? 'border-[color:var(--color-accent)] text-ink'
              : 'border-edge-soft text-ink-faint hover:text-ink-dim'
          }`}
        >
          Whole alliance
        </button>
        {divisions.map((d) => {
          const accent = accentOf(d)
          const on = focus === d.division_code
          return (
            <button
              key={d.division_code}
              onClick={() => setFocus(on ? null : d.division_code)}
              className="border px-2.5 py-1 transition-colors"
              style={{
                borderColor: on ? accent : 'var(--color-edge-soft)',
                color: on ? accent : 'var(--color-ink-faint)',
              }}
            >
              {d.division_name}
            </button>
          )
        })}
      </div>

      {!ready ? (
        <Loading label="Drawing the network" />
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          <RouteMap
            arcs={pinned && fanned ? fanned : arcs}
            nodes={nodes}
            highlightDivision={pinned ? null : focus}
            focusedAirport={pinned}
            onPickAirport={pickAirport}
            className="w-full"
            zoomOnFocus
          />
          <div>
            <h2 className="display text-2xl">Busiest airports</h2>
            <p className="mt-1 text-ink-faint">By weekly alliance departures</p>
            {/* overflow-hidden CLIPPED this on a phone: the table is 456px wide
                 and three of its columns simply were not there. */}
            <div className="panel mt-4 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-2 text-left">
                    {['', 'City', 'Carriers', 'Weekly'].map((h) => (
                      <th
                        key={h}
                        className="mono px-3 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {busiestPage.slice.map((a) => (
                    <tr key={a.iata_code} className="border-t border-edge-soft">
                      <td className="mono px-3 py-2">
                        <Link to={`/airports/${a.iata_code}`} className="text-cyan">
                          {a.iata_code}
                        </Link>
                      </td>
                      <td className="truncate px-3 py-2 text-ink">{a.city_name ?? '—'}</td>
                      <td className="mono px-3 py-2 text-ink-dim">{num(a.carriers)}</td>
                      <td className="mono px-3 py-2 text-ink-dim">
                        {num(a.weekly_departures)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager paged={busiestPage} label="airports" />
          </div>
        </div>
      )}
    </div>
  )
}
