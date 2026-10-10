import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import RouteMap from '../components/RouteMap'
import EchoMark from '../components/EchoMark'
import { AirlineCard, Loading, NotConfigured } from '../components/ui'
import { isConfigured } from '../lib/supabase'
import { heldAirlines, searchAirlines, useDivision, useNetworkArcs, useNetworkNodes } from '../lib/data'
import type { Airline, Arc, NetworkNode } from '../lib/types'
import { accentOf, num } from '../lib/format'

const NO_ARCS: Arc[] = []
const NO_NODES: NetworkNode[] = []

export default function DivisionPage() {
  const { code = '' } = useParams()
  // The division itself comes out of the list Home and the divisions page
  // already hold, so arriving from either opens the header at once; the
  // members, the arcs and the nodes each land on their own behind it.
  const division = useDivision(code) ?? null
  const search = useMemo(() => ({ division: code, limit: 300 }), [code])
  const [members, setMembers] = useState<Airline[] | null>(() => heldAirlines(search) ?? null)
  const arcs = useNetworkArcs(900, 'busiest') ?? NO_ARCS
  const nodes = useNetworkNodes(600) ?? NO_NODES
  const [sort, setSort] = useState<'prominence' | 'name' | 'fleet'>('prominence')

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false
    setMembers(heldAirlines(search) ?? null)
    searchAirlines(search)
      .catch(() => [] as Airline[])
      .then((list) => {
        if (!cancelled) setMembers(list)
      })
    return () => {
      cancelled = true
    }
  }, [search])

  const sorted = useMemo(() => {
    if (!members) return null
    const c = [...members]
    if (sort === 'name') {
      c.sort((x, y) => (x.airline_name ?? '').localeCompare(y.airline_name ?? ''))
    } else if (sort === 'fleet') {
      c.sort((x, y) => y.fleet_size - x.fleet_size)
    }
    return c
  }, [members, sort])

  if (!isConfigured) return <NotConfigured />
  if (!division) return <Loading label="Loading division" />

  const accent = accentOf(division)

  return (
    <div>
      <section className="relative overflow-hidden border-b border-edge-soft">
        <div
          className="pointer-events-none absolute inset-0"
          style={{ background: `radial-gradient(760px 340px at 78% 30%, ${accent}1c, transparent 70%)` }}
        />
        <div className="mx-auto grid max-w-[1180px] gap-8 px-4 py-8 sm:px-5 sm:py-14 lg:grid-cols-[1.1fr_.9fr]">
          <div>
            <Link to="/divisions" className="mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">
              ← All divisions
            </Link>
            <div className="mt-4 flex items-center gap-4">
              <EchoMark height={34} color={accent} />
              <h1 className="display text-[clamp(40px,6vw,72px)]" style={{ color: accent }}>
                {division.division_name}
              </h1>
            </div>
            {division.alliance_description && (
              <p className="mt-4 max-w-[60ch] whitespace-pre-line text-ink-dim">
                {division.alliance_description}
              </p>
            )}
            <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
              {[
                ['Carriers', division.carriers],
                ['Aircraft', division.aircraft],
                ['Routes', division.routes],
                ['Destinations', division.destinations],
              ].map(([l, v]) => (
                <div key={l as string}>
                  <div className="mono text-2xl" style={{ color: accent }}>
                    {num(Number(v))}
                  </div>
                  <div className="text-[11px] uppercase tracking-[0.09em] text-ink-faint">{l}</div>
                </div>
              ))}
            </div>
            {division.top_hubs && division.top_hubs.length > 0 && (
              <div className="mt-7">
                <div className="eyebrow mb-2 text-ink-faint">Principal hubs</div>
                <div className="flex flex-wrap gap-2">
                  {division.top_hubs.map((h) => (
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
          </div>

          <div>
            <RouteMap
              arcs={arcs}
              nodes={nodes}
              highlightDivision={code}
              className="w-full"
            />
            <p className="mono mt-1 text-center text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              {division.division_name} routes lit · rest of the alliance dimmed
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-14">
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="display text-3xl">
            Member carriers{' '}
            <span className="mono align-middle text-base text-ink-faint">
              {members ? members.length : ''}
            </span>
          </h2>
          <div className="mono flex gap-1 text-[11px] uppercase tracking-[0.1em]">
            {(['prominence', 'name', 'fleet'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSort(s)}
                className={`border px-2.5 py-1 transition-colors ${
                  sort === s
                    ? 'border-[color:var(--color-accent)] text-ink'
                    : 'border-edge-soft text-ink-faint hover:text-ink-dim'
                }`}
              >
                {s === 'prominence' ? 'Size' : s === 'name' ? 'A–Z' : 'Fleet'}
              </button>
            ))}
          </div>
        </div>

        {sorted === null ? (
          <Loading />
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sorted.map((a) => (
              <AirlineCard key={a.uid} a={a} />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
