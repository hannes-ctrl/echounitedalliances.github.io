import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Loading, NotConfigured } from '../components/ui'
import Pager, { usePaged } from '../components/Pager'
import { isConfigured, supabase } from '../lib/supabase'
import { load, peek } from '../lib/cache'
import { rows } from '../lib/data'
import type { AirportRow } from '../lib/types'
import { flag, num } from '../lib/format'

const KEPT = { fresh: 10 * 60 * 1000 }

type Carrier = {
  uid: string
  division_code: string
  division_name: string
  accent_color: string | null
  airline_slug: string
  carrier_code: string
  airline_name: string | null
  destinations_from_here: number
  is_hub: boolean
}

/** Find-by-airport: who in the alliance serves this place, and how widely. */
export default function AirportPage() {
  const { iata = '' } = useParams()
  const [airport, setAirport] = useState<AirportRow | null>(null)
  const [carriers, setCarriers] = useState<Carrier[] | null>(null)
  // Above the early return below: a hook after it runs on some renders
  // and not others, which crashes the page.
  const carrierPage = usePaged(carriers ?? [])

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false
    const code = iata.toUpperCase()
    setAirport(peek<AirportRow | null>(`airport:${code}`) ?? null)
    setCarriers(peek<Carrier[]>(`airport:carriers:${code}`) ?? null)
    // Two reads, each drawn when it lands. They used to share one Promise.all:
    // the airport is a single row of a materialised view and answers in a
    // tenth of a second, and airport_carriers took 2 to 7 seconds for Heathrow
    // on 10 October 2026 -- with the whole page a spinner until it had.
    load(
      `airport:${code}`,
      () =>
        rows<AirportRow | null>(
          supabase.from('mv_airport_directory').select('*').eq('iata_code', code).maybeSingle(),
        ),
      KEPT,
    )
      .catch(() => null)
      .then((row) => {
        if (!cancelled) setAirport(row)
      })
    load(
      `airport:carriers:${code}`,
      () => rows<Carrier[]>(supabase.rpc('airport_carriers', { p_iata: code })).then((list) => list ?? []),
      KEPT,
    )
      .catch(() => [] as Carrier[])
      .then((list) => {
        if (!cancelled) setCarriers(list)
      })
    return () => {
      cancelled = true
    }
  }, [iata])

  if (!isConfigured) return <NotConfigured />
  if (!airport) return <Loading label="Loading airport" />

  const hubs = (carriers ?? []).filter((c) => c.is_hub)

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-14">
      <p className="eyebrow text-cyan">Airport</p>
      <div className="mt-3 flex flex-wrap items-baseline gap-4">
        <h1 className="display text-[clamp(40px,6vw,72px)]">{airport.iata_code}</h1>
        <div>
          <div className="text-xl text-ink">{airport.city_name ?? '—'}</div>
          <div className="text-ink-faint">
            {airport.airport_name ?? ''}{' '}
            {airport.country_code && (
              <span className="mono ml-1">{flag(airport.country_code)} {airport.country_code}</span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {[
          ['Alliance carriers', airport.carriers],
          ['Weekly departures', airport.weekly_departures],
          ['Destinations served', airport.out_degree],
          ['A hub for', airport.hub_for],
        ].map(([l, v]) => (
          <div key={l as string}>
            <div className="mono text-2xl text-ink">{num(Number(v))}</div>
            <div className="text-[11px] uppercase tracking-[0.09em] text-ink-faint">{l}</div>
          </div>
        ))}
      </div>

      {airport.timezone && (
        <p className="mono mt-5 text-[12px] text-ink-faint">
          Local time zone {airport.timezone}
        </p>
      )}

      {hubs.length > 0 && (
        <section className="mt-12">
          <h2 className="display text-2xl">Hubbed here</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {hubs.map((c) => (
              <Link
                key={c.uid}
                to={`/d/${c.division_code}/${c.airline_slug}`}
                className="mono border px-3 py-1.5 text-[12px] transition-colors"
                style={{
                  borderColor: `${c.accent_color ?? '#A855F7'}55`,
                  color: c.accent_color ?? '#A855F7',
                }}
              >
                {c.airline_name?.trim() || c.carrier_code}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12">
        <h2 className="display text-2xl">
          Carriers serving {airport.iata_code}{' '}
          <span className="mono align-middle text-base text-ink-faint">
            {carriers ? carriers.length : ''}
          </span>
        </h2>
        {carriers === null ? (
          <Loading />
        ) : carriers.length === 0 ? (
          <p className="panel mt-4 p-8 text-center text-ink-dim">
            No alliance carrier currently departs {airport.iata_code}.
          </p>
        ) : (
          <div className="panel mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="bg-surface-2 text-left">
                  {['Carrier', 'Division', 'Destinations from here', ''].map((h) => (
                    <th key={h} className="mono px-4 py-2 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {carrierPage.slice.map((c) => (
                  <tr key={c.uid} className="border-t border-edge-soft">
                    <td className="px-4 py-2.5">
                      <Link
                        to={`/d/${c.division_code}/${c.airline_slug}`}
                        className="text-ink transition-colors hover:text-cyan"
                      >
                        {c.airline_name?.trim() || 'Unnamed carrier'}
                      </Link>
                      <span className="mono ml-2 text-[11px] text-ink-faint">{c.carrier_code}</span>
                    </td>
                    <td className="mono px-4 py-2.5 text-[12px]" style={{ color: c.accent_color ?? undefined }}>
                      {c.division_name}
                    </td>
                    <td className="mono px-4 py-2.5 text-ink-dim">{c.destinations_from_here}</td>
                    <td className="px-4 py-2.5 text-right">
                      {c.is_hub && (
                        <span className="mono border border-edge px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                          Hub
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager paged={carrierPage} label="carriers" />
          </div>
        )}
      </section>
    </div>
  )
}
