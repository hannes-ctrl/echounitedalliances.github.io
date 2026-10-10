import { Link } from 'react-router-dom'
import { isConfigured } from '../lib/supabase'
import { useDivisions } from '../lib/data'
import { accentOf, capitalise, num, spell } from '../lib/format'
import { useDivisionCount } from '../lib/carriers'
import { DIVISION_NOTES } from '../lib/site'
import { Loading, NotConfigured } from '../components/ui'
import EchoMark from '../components/EchoMark'

/**
 * Every division, three across: nine of them since Eos opened on 2 October
 * 2026, which squares the grid that eight used to fill four across.
 *
 * They used to be full-width rows, which gave one of them room for a long
 * welcome message and the other seven a one-line summary — so the page read as
 * a list with an odd first entry rather than as a group of equals. Every card
 * now carries the same summary of what its division actually flies, and the
 * order is group policy, held in sort_order by 16_division_policy.sql.
 */
export default function Divisions() {
  // Shared with Home and kept across visits (lib/data.ts), so this page is
  // usually drawn from what is already held rather than from a fresh read.
  const rows = useDivisions() ?? null
  const divisionCount = useDivisionCount()

  if (!isConfigured) return <NotConfigured />

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-14">
      <p className="eyebrow text-cyan">The group</p>
      <h1 className="display mt-3 text-[clamp(36px,5vw,58px)]">
        {capitalise(spell(rows?.length || divisionCount))} divisions
      </h1>
      <p className="mt-4 max-w-[64ch] text-lg text-ink-dim">
        Echo United Alliances is a multi-alliance group: each division runs its
        own roster and its own leadership, and members fly under one network.
      </p>

      {rows === null ? (
        <Loading />
      ) : (
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((d, i) => {
            const accent = accentOf(d)
            const note = DIVISION_NOTES[d.division_code]
            return (
              <Link
                key={d.division_code}
                to={`/d/${d.division_code}`}
                className="panel lift rise flex flex-col justify-between gap-4 p-5 sm:aspect-square"
                style={{ animationDelay: `${i * 40}ms`, ['--card-accent' as string]: accent }}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <EchoMark height={17} color={accent} />
                    <h2 className="display truncate text-2xl" style={{ color: accent }}>
                      {d.division_name}
                    </h2>
                  </div>

                  {note && (
                    <span
                      className="mono mt-3 inline-block border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]"
                      style={{
                        color: accent,
                        borderColor: `color-mix(in srgb, ${accent} 45%, transparent)`,
                      }}
                    >
                      {note}
                    </span>
                  )}

                  <p className={`text-[12px] leading-relaxed text-ink-dim ${note ? 'mt-3' : 'mt-4'}`}>
                    {num(d.carriers)} member carriers flying {num(d.routes)} routes
                    to {num(d.destinations)} destinations.
                  </p>
                </div>

                <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {[
                    ['Carriers', d.carriers],
                    ['Aircraft', d.aircraft],
                    ['Routes', d.routes],
                    ['Destinations', d.destinations],
                  ].map(([label, v]) => (
                    <div key={label as string}>
                      <dd className="mono text-[15px] leading-none text-ink">{num(Number(v))}</dd>
                      <dt className="mt-1.5 text-[9px] uppercase tracking-[0.1em] text-ink-faint">
                        {label}
                      </dt>
                    </div>
                  ))}
                </dl>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
