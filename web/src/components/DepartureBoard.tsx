import { useCallback, useEffect, useMemo, useState } from 'react'
import AirportField from './AirportField'
import SplitFlap, { toFlap } from './SplitFlap'
import { Loading } from './ui'
import type { BoardRow } from './SplitFlap'
import { isConfigured, supabase } from '../lib/supabase'
import { useHubs, type Hub } from '../lib/data'
import type { BoardDeparture } from '../lib/types'

/**
 * The departure board, live.
 *
 * It used to ask the database for a list once and print the origin airport's
 * own clock string. Two things were wrong with that. The query had no time
 * filter, so it always returned the earliest departures of the day and the
 * board sat frozen on a row of 00:00 flights. And a bare "00:00" carries no
 * zone, so a viewer in Ho Chi Minh City and a viewer in Boston were both shown
 * a number that meant nothing to either of them.
 *
 * board_departures returns departs_at as a real instant, so rendering it is
 * Intl's problem. It is rendered in the AIRPORT's zone, not the viewer's,
 * because that is what a departure board is: the times on the screen at
 * Changi are Singapore's, whoever is reading them. Showing a Frankfurt board
 * on a Melbourne clock was technically defensible and practically useless.
 *
 * It also no longer asks where the viewer is. It used to send the browser's
 * timezone so the database could pick the hub the viewer was probably
 * standing in, which is a location guess nobody asked to make. The board now
 * opens at the alliance's busiest airport and lets anyone choose any other --
 * not just the six biggest, which was the other half of the same complaint.
 *
 * Three clocks, on purpose, because they cost different amounts:
 *   - the flights are refetched once a minute (a network round trip),
 *   - the countdowns are recomputed every fifteen seconds (a re-render),
 *   - the wall clock ticks every second (one isolated component).
 * Keeping the seconds hand in its own component is what stops the board's 376
 * character cells from re-rendering once a second for the sake of a colon.
 */

const REFETCH_MS = 60_000
const TICK_MS = 15_000

/**
 * Formatters bound to one airport's zone.
 *
 * An unknown or missing zone falls back to the viewer's, which is what Intl
 * does with an undefined timeZone anyway -- better a clock that is at least
 * internally consistent than a thrown RangeError on a board.
 */
function timeFormatter(tz?: string | null) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: tz || undefined,
    })
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
  }
}

function clockFormatter(tz?: string | null) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZone: tz || undefined,
    })
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
  }
}

/**
 * Status is a pure function of the clock, and that is not a shortcut: every
 * flight in the alliance schedule is by definition on schedule. What is real is
 * how long until it goes, so that is what the column counts down — and it is
 * why the board keeps moving between refetches.
 */
function statusFor(departsAt: number, now: number) {
  const ms = departsAt - now
  // Only DEPARTED once it has actually gone. Rounding to the nearest minute
  // said DEPARTED nine seconds before the aircraft left.
  if (ms <= 0) return 'DEPARTED'
  const mins = Math.ceil(ms / 60_000)
  if (mins <= 15) return 'BOARDING'
  if (mins < 60) return `IN ${mins} MIN`
  return 'ON TIME'
}

function WallClock({ tz }: { tz?: string | null }) {
  const [now, setNow] = useState(() => new Date())
  const fmt = useMemo(() => clockFormatter(tz), [tz])
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="tabular-nums">{fmt.format(now)}</span>
}

const NO_HUBS: Hub[] = []

/** The last board read for each origin, for as long as it is still current. */
const lastBoards = new Map<string | null, { at: number; rows: BoardDeparture[] }>()

function recentBoard(pick: string | null): BoardDeparture[] | null {
  const last = lastBoards.get(pick)
  return last && Date.now() - last.at < REFETCH_MS ? last.rows : null
}

export default function DepartureBoard({ origin }: { origin?: string }) {
  // null means "the alliance's busiest airport" -- NOT "wherever you are".
  const [pick, setPick] = useState<string | null>(origin ?? null)
  // A board read within the last minute is still the board: coming back to
  // Home opens on it instead of on the loader, and the read below replaces it.
  const [departures, setDepartures] = useState<BoardDeparture[]>(() => recentBoard(pick) ?? [])
  // The alliance's busiest airports, so the board is not stuck on whichever
  // one happens to share the viewer's clock. They do not move; shared and
  // kept across visits by lib/data.ts.
  const hubs = useHubs() ?? NO_HUBS
  const [now, setNow] = useState(() => Date.now())
  const [loaded, setLoaded] = useState(() => recentBoard(pick) !== null)
  /** What has been typed into the "any airport" box. */
  const [typed, setTyped] = useState('')

  const load = useCallback(async () => {
    if (!isConfigured) return
    const { data, error } = await supabase.rpc('board_departures', {
      p_origin: pick,
      p_limit: 8,
      // Deliberately null. This used to be the browser's timezone, which the
      // database used to guess which airport the viewer was standing in --
      // a location inference for a board nobody had asked to personalise.
      p_viewer_tz: null,
    })
    if (!error) {
      const list = (data as BoardDeparture[]) ?? []
      lastBoards.set(pick, { at: Date.now(), rows: list })
      setDepartures(list)
    }
    setLoaded(true)
    setNow(Date.now())
  }, [pick])

  // New flights once a minute, and immediately on returning to the tab: a
  // backgrounded tab has its timers throttled, so without this the board would
  // still be showing a stale minute when the viewer looks back at it.
  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), REFETCH_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // The countdowns, between fetches.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), TICK_MS)
    return () => window.clearInterval(id)
  }, [])

  const hubTz = departures[0]?.origin_tz ?? null
  const timeFmt = useMemo(() => timeFormatter(hubTz), [hubTz])

  const rows: BoardRow[] = useMemo(
    () =>
      departures.map((r) => {
        const at = new Date(r.departs_at)
        return {
          time: timeFmt.format(at),
          flight: toFlap(r.flight_designator, r.carrier_code),
          destination: toFlap(r.destination_city, r.destination_iata),
          carrier: toFlap(r.airline_name, r.carrier_code),
          status: statusFor(at.getTime(), now),
          accent: r.accent_color,
        }
      }),
    [departures, now, timeFmt],
  )

  const hub = departures[0]

  return (
    <>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h2 className="display text-2xl">
          Departures
          {hub && (
            <span className="ml-3 text-base font-normal text-ink-dim">
              {hub.origin_city} ({hub.origin_iata})
            </span>
          )}
        </h2>
        <p className="mono flex flex-wrap items-baseline gap-x-2 text-[10px] uppercase tracking-[0.16em] text-ink-dim">
          <span>Local time{hub ? ` at ${hub.origin_iata}` : ''}</span>
          <span aria-hidden="true">·</span>
          <WallClock tz={hubTz} />
        </p>
      </div>

      {rows.length > 0 ? (
        <SplitFlap rows={rows} />
      ) : (
        <div className="board">
          {isConfigured && !loaded ? (
            <Loading label="Reading the board" />
          ) : (
            <div className="mono py-16 text-center text-[11px] uppercase tracking-[0.16em] text-ink-faint">
              {isConfigured ? 'No departures scheduled' : 'Board offline'}
            </div>
          )}
        </div>
      )}

      {hubs.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="mono mr-1 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
            Board at
          </span>
          <button
            type="button"
            onClick={() => setPick(null)}
            aria-pressed={pick === null}
            className={`chip ${pick === null ? 'chip-on' : ''}`}
          >
            Busiest
          </button>
          {hubs.map((h) => (
            <button
              key={h.iata_code}
              type="button"
              onClick={() => setPick(h.iata_code)}
              aria-pressed={pick === h.iata_code}
              className={`chip ${pick === h.iata_code ? 'chip-on' : ''}`}
              title={h.city_name ?? h.airport_name ?? h.iata_code}
            >
              {h.iata_code}
            </button>
          ))}
          {/* The six chips are shortcuts, not the whole choice. Any airport
              the alliance serves has a board, and this is how to reach the
              other two thousand. */}
          <div className="w-full sm:w-64">
            <AirportField
              id="board-any-airport"
              label=""
              value={typed}
              onChange={(code) => {
                setTyped(code)
                if (code.length === 3) setPick(code)
              }}
              placeholder="Any other airport"
            />
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-dim">
        {hub
          ? `Next departures from ${hub.origin_city}. Every time here is local to ${hub.origin_iata}${
              hub.origin_tz ? ` (${hub.origin_tz})` : ''
            }, the way the board at the airport reads. Refreshed every minute.`
          : 'Live from the alliance schedule.'}
      </p>
    </>
  )
}
