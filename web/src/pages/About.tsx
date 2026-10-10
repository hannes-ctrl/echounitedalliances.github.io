import { Link } from 'react-router-dom'
import { isConfigured } from '../lib/supabase'
import { useDivisions } from '../lib/data'
import { LEADERS, SLOGAN, STORY } from '../lib/alliance'
import { accentOf, num, spell } from '../lib/format'
import { useDivisionCount } from '../lib/carriers'
import { Loading, NotConfigured } from '../components/ui'
import EchoMark from '../components/EchoMark'

/**
 * Who runs Echo.
 *
 * The roster is in lib/alliance.ts; the division names, ordering and accent
 * colours come from the database, so renaming or reordering a division moves
 * this page too without anyone remembering to.
 *
 * There is no origin story here yet, deliberately. Rather than fill the space
 * with something invented, the page carries what is actually known — the
 * slogan, the division leaders, and the size of the thing they run.
 */
export default function About() {
  // A failed read is not an empty group. Treated as one, this page reported
  // every leader as "not a division on record" while the weekly refresh held
  // the tables (2 October 2026). The shared read in lib/data.ts tries twice
  // and never answers an error with an empty list: this stays null, and the
  // page stays loading.
  const divisions = useDivisions() ?? null
  const divisionCount = useDivisionCount()

  if (!isConfigured) return <NotConfigured />

  const byCode = new Map((divisions ?? []).map((d) => [d.division_code, d]))
  // Division order is group policy and lives in sort_order, so the board is
  // listed the way the divisions are listed everywhere else.
  // filter, not find: a division can be led by more than one person, and
  // taking only the first would drop a co-leader without saying so.
  const board = (divisions ?? [])
    .map((d) => ({
      division: d,
      leaders: LEADERS.filter((l) => l.division_code === d.division_code),
    }))
    .filter((row) => row.leaders.length > 0)

  const totals = (divisions ?? []).reduce(
    (a, d) => ({
      carriers: a.carriers + Number(d.carriers),
      aircraft: a.aircraft + Number(d.aircraft),
    }),
    { carriers: 0, aircraft: 0 },
  )

  return (
    <div className="mx-auto max-w-[1180px] px-4 py-8 sm:px-5 sm:py-14">
      <p className="eyebrow text-cyan">About</p>
      <h1 className="display mt-3 text-[clamp(34px,6vw,72px)]">{SLOGAN}</h1>
      {/* Two sentences, and the figures are a third. Splicing them into the
          middle of a sentence left it reading "...as one network. the
          excellence in the name" for as long as the query was in flight. */}
      <p className="mt-5 max-w-[64ch] text-lg text-ink-dim">
        Echo United Alliances is a group of {spell(divisionCount)} alliances in The Airline
        Simulator, each running its own roster and its own leadership, flying as
        one network. The excellence in the name is not one airline's — it is all
        of them, and the people who keep them flying together.
      </p>
      {divisions !== null && (
        <p className="mono mt-4 text-[12px] uppercase tracking-[0.14em] text-ink-faint">
          {num(totals.carriers)} carriers · {num(totals.aircraft)} aircraft · {divisions.length} divisions
        </p>
      )}

      {/* The board's own account of where Echo came from and who it is for.
          It sits above the leadership roster because it answers the question
          somebody actually arrived with. */}
      <section className="mt-14 border-t border-edge-soft pt-10">
        <h2 className="display text-2xl">Our story</h2>
        <div className="mt-6 grid gap-8 lg:grid-cols-[1.7fr_1fr] lg:gap-12">
          <div className="flex flex-col gap-4">
            {STORY.paragraphs.map((p) => (
              <p key={p.slice(0, 32)} className="max-w-[64ch] text-ink-dim">
                {p}
              </p>
            ))}
            <p className="display mt-2 max-w-[64ch] text-xl text-ink">{STORY.closing}</p>
          </div>

          <dl className="panel h-fit p-5">
            <div>
              <dt className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                Founded
              </dt>
              <dd className="mono mt-1 text-lg text-ink">{STORY.founded}</dd>
            </div>
            <div className="mt-5">
              <dt className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                Founded as
              </dt>
              <dd className="mt-1 text-lg text-ink">{STORY.foundedAs}</dd>
            </div>
            <div className="mt-5">
              <dt className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                Founding members
              </dt>
              <dd className="mono mt-1 text-lg text-ink">{STORY.foundingMembers}</dd>
            </div>
            {divisions !== null && (
              <div className="mt-5 border-t border-edge-soft pt-5">
                <dt className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
                  Carriers today
                </dt>
                <dd className="mono mt-1 text-lg text-cyan">{num(totals.carriers)}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <section className="mt-14">
        <h2 className="display text-2xl">The board</h2>
        <p className="mt-1 max-w-[62ch] text-ink-faint">
          Echo's board is its division leaders — the people who run each
          alliance also run the group. They are listed here by the name and
          handle they go by on Discord, which is where the group actually
          meets; several of them own more than one carrier.
        </p>

        {divisions === null ? (
          <Loading />
        ) : (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {board.map(({ division, leaders }, i) => {
              const accent = accentOf(division)
              return (
                <article
                  key={division.division_code}
                  className="panel rise flex flex-col justify-between gap-4 p-5"
                  style={{ animationDelay: `${i * 40}ms`, ['--card-accent' as string]: accent }}
                >
                  <div>
                    <div className="flex items-center gap-2.5">
                      <EchoMark height={15} color={accent} />
                      <Link
                        to={`/d/${division.division_code}`}
                        className="mono text-[10px] uppercase tracking-[0.16em] transition-colors hover:text-ink"
                        style={{ color: accent }}
                      >
                        {division.division_name}
                      </Link>
                    </div>
                    {leaders.map((leader) => (
                      <div key={leader.discord} className="mt-3">
                        <p className="display text-2xl text-ink">{leader.name}</p>
                        <p className="mono mt-1 text-[12px] text-ink-faint">@{leader.discord}</p>
                      </div>
                    ))}
                  </div>
                  <p className="mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">
                    {num(division.carriers)} carriers
                  </p>
                </article>
              )
            })}
          </div>
        )}

        {/* A leader named for a division the database does not have, or a
            division with nobody listed, would otherwise vanish silently. */}
        {divisions !== null &&
          LEADERS.filter((l) => !byCode.has(l.division_code)).map((l) => (
            <p key={l.discord} className="mono mt-3 text-[11px] text-danger">
              {l.name} is listed for “{l.division_code}”, which is not a division on record.
            </p>
          ))}
        {divisions !== null && board.length < divisions.length && (
          <p className="mono mt-3 text-[11px] text-ink-faint">
            {divisions.length - board.length} division(s) have no leader listed in
            web/src/lib/alliance.ts.
          </p>
        )}
      </section>

      <section className="mt-14">
        <h2 className="display text-2xl">Joining</h2>
        <p className="mt-2 max-w-[62ch] text-ink-dim">
          Every division takes applications in two places — in the game, and on
          the Echo Discord — and every one of them is read by hand.{' '}
          <Link to="/divisions" className="text-cyan">
            Meet the divisions
          </Link>{' '}
          to pick one, or see{' '}
          <Link to="/activities" className="text-cyan">
            what the group does together
          </Link>
          .
        </p>
      </section>
    </div>
  )
}
