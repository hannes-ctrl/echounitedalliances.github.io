import { useEffect, useState } from 'react'

/**
 * What the site has already read, kept so it is not read again.
 *
 * Every page used to ask the database for everything it shows each time it
 * mounted: Home, Divisions, About, the directory, the network map and the
 * account page each fetched v_division_summary for themselves, and going Back
 * fetched it again. That view takes between 1.6 and 7.7 seconds on the hosted
 * database (measured 10 October 2026), so the cost was not small.
 *
 * Three things happen here, and only to public game data -- nothing about an
 * account or a booking ever goes through this file:
 *
 *   - One answer per question. Two components asking for the same thing share
 *     a single request, and a page opened a second time draws from memory.
 *   - Stale while revalidating. An answer older than its `fresh` window is
 *     still shown at once, and replaced when the new one lands. The data moves
 *     once a week with the scrape, so yesterday's figure is nearly always
 *     today's -- and a spinner for seven seconds is never right.
 *   - Optionally across visits, in localStorage. Only for the few reads marked
 *     `persist`, and never trusted past MAX_AGE_MS.
 *
 * A failed read is not an answer: it is not stored, whoever asked gets the
 * previous value if there is one, and the next asker tries again.
 */

export type ReadOptions = {
  /** How long an answer is used without asking again. Default five minutes. */
  fresh?: number
  /** Keep it in localStorage, so the next visit opens on it. */
  persist?: boolean
}

type Entry = { value: unknown; at: number }

const DEFAULT_FRESH_MS = 5 * 60 * 1000
/** A stored answer older than this is not shown at all, only replaced. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
/** Bump the number when a stored shape changes, so old copies are ignored. */
const PREFIX = 'echo:1:'
/** Answers held in memory at once. The oldest unpersisted ones go first. */
const HELD = 160

const entries = new Map<string, Entry>()
const inFlight = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<() => void>>()

function fromStorage(key: string): Entry | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: unknown; v?: unknown }
    if (typeof parsed.at !== 'number' || parsed.v === undefined) return null
    if (Date.now() - parsed.at > MAX_AGE_MS) return null
    return { value: parsed.v, at: parsed.at }
  } catch {
    // Private mode, a blocked store, or a copy something else wrote over.
    return null
  }
}

function toStorage(key: string, entry: Entry): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify({ at: entry.at, v: entry.value }))
  } catch {
    /* full or unavailable: the site works the same, it just asks next time */
  }
}

function entryOf(key: string, persist?: boolean): Entry | null {
  const held = entries.get(key)
  if (held) return held
  if (!persist) return null
  const stored = fromStorage(key)
  if (stored) entries.set(key, stored)
  return stored
}

function trim(): void {
  if (entries.size <= HELD) return
  // Map keeps insertion order, so the first keys are the oldest answers.
  for (const key of entries.keys()) {
    if (entries.size <= HELD) return
    if (!inFlight.has(key) && !listeners.get(key)?.size) entries.delete(key)
  }
}

/** What is held for this key right now, however old, without asking. */
export function peek<T>(key: string, persist?: boolean): T | undefined {
  return entryOf(key, persist)?.value as T | undefined
}

/** True when the held answer is recent enough to use without asking again. */
export function isFresh(key: string, options: ReadOptions = {}): boolean {
  const entry = entryOf(key, options.persist)
  return !!entry && Date.now() - entry.at < (options.fresh ?? DEFAULT_FRESH_MS)
}

/**
 * Store an answer. If it says the same as the one already held, the held
 * object stays -- so a revalidation that changed nothing does not hand React
 * a new array and redraw a 900-arc map for it.
 */
export function put<T>(key: string, value: T, persist?: boolean): T {
  const held = entries.get(key)
  let kept = value
  if (held && held.value !== value) {
    try {
      if (JSON.stringify(held.value) === JSON.stringify(value)) kept = held.value as T
    } catch {
      /* not comparable: treat as changed */
    }
  }
  const entry = { value: kept, at: Date.now() }
  entries.delete(key)
  entries.set(key, entry)
  if (persist) toStorage(key, entry)
  trim()
  if (!held || held.value !== kept) {
    for (const notify of listeners.get(key) ?? []) notify()
  }
  return kept
}

/** Forget an answer, so the next reader asks again. For after an admin edit. */
export function forget(key: string): void {
  entries.delete(key)
  try {
    window.localStorage.removeItem(PREFIX + key)
  } catch {
    /* nothing was stored */
  }
}

// ---------------------------------------------------------------------------
// Knowing when the page has finished asking
// ---------------------------------------------------------------------------

let pending = 0
const quietWaiters = new Set<() => void>()

function settle(): void {
  pending -= 1
  if (pending > 0) return
  // A beat, not immediately: one read finishing is often what starts the next
  // (routes, then the airports those routes touch).
  window.setTimeout(() => {
    if (pending > 0) return
    const waiting = [...quietWaiters]
    quietWaiters.clear()
    for (const go of waiting) go()
  }, 250)
}

/** Resolves once no read made through this file is outstanding. */
export function whenQuiet(): Promise<void> {
  return new Promise((resolve) => {
    quietWaiters.add(resolve)
    if (pending === 0) {
      pending += 1
      settle()
    }
  })
}

/**
 * Read through the cache.
 *
 * Fresh: resolves with what is held, and asks nothing. Otherwise asks -- once,
 * however many callers arrive while it is out -- and resolves with the new
 * answer. If asking fails and something older is held, resolves with that.
 */
export function load<T>(key: string, read: () => Promise<T>, options: ReadOptions = {}): Promise<T> {
  const entry = entryOf(key, options.persist)
  if (entry && Date.now() - entry.at < (options.fresh ?? DEFAULT_FRESH_MS)) {
    return Promise.resolve(entry.value as T)
  }
  const out = inFlight.get(key)
  if (out) return out as Promise<T>

  pending += 1
  const asked = read()
    .then((value) => put(key, value, options.persist))
    .catch((error: unknown) => {
      const older = entries.get(key)
      if (older) return older.value as T
      throw error
    })
    .finally(() => {
      inFlight.delete(key)
      settle()
    })
  inFlight.set(key, asked)
  return asked
}

function subscribe(key: string, notify: () => void): () => void {
  let set = listeners.get(key)
  if (!set) listeners.set(key, (set = new Set()))
  set.add(notify)
  return () => {
    set.delete(notify)
    if (set.size === 0) listeners.delete(key)
  }
}

/**
 * Whatever is held for a key, kept current -- without asking for it. For a
 * component that shows something another module is responsible for reading.
 * A null key holds nothing, for when the key is not known yet.
 */
export function useHeld<T>(key: string | null, persist?: boolean): T | undefined {
  // The key is kept beside the value so that a change of key answers from the
  // new key on the very same render, not one effect later -- otherwise a page
  // that moves from one carrier to another draws the first carrier's fleet
  // under the second one's name for a frame.
  const [state, setState] = useState(() => ({
    key,
    value: key === null ? undefined : peek<T>(key, persist),
  }))
  let current = state
  if (state.key !== key) {
    current = { key, value: key === null ? undefined : peek<T>(key, persist) }
    setState(current)
  }

  useEffect(() => {
    if (key === null) return
    const sync = () => {
      const value = peek<T>(key, persist)
      setState((was) => (was.key === key && was.value === value ? was : { key, value }))
    }
    // Something may have landed between the render and this effect.
    sync()
    return subscribe(key, sync)
  }, [key, persist])

  return current.value
}

/**
 * Read through the cache from a component: the held answer on the first
 * render if there is one, the new one when it lands, undefined until either.
 */
export function useCached<T>(
  key: string | null,
  read: () => Promise<T>,
  options: ReadOptions = {},
): T | undefined {
  const value = useHeld<T>(key, options.persist)
  const { fresh, persist } = options

  useEffect(() => {
    if (key === null) return
    // The answer reaches the component through useHeld. A failure with
    // nothing held leaves it undefined, which every caller draws as loading.
    load(key, read, { fresh, persist }).catch(() => {})
    // `read` is a new closure on every render and always asks the same
    // question for the same key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fresh, persist])

  return value
}
