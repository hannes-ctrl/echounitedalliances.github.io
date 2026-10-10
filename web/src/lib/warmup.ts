import { whenQuiet } from './cache'
import { readAhead } from './data'

/**
 * Use the welcome animation.
 *
 * The arrival sequence holds the screen for 4.6 seconds on every visit, and
 * the page underneath has usually finished its own reading well inside that.
 * The rest of the time was spent waiting for nothing. It now goes on what the
 * visitor is most likely to open next: the other pages' code, and the reads
 * those pages start with -- so the first click after the animation lands on a
 * page that is already there.
 *
 * Nothing here is allowed to slow down what is on screen:
 *
 *   - it starts only once the current page's own reads are all back;
 *   - it reads one thing at a time, and waits for quiet again between them,
 *     so a click in the middle goes to the front of the queue;
 *   - it does nothing at all for a visitor who has asked for less data, or on
 *     a connection the browser reports as 2G.
 */

type Connection = { saveData?: boolean; effectiveType?: string }

function frugal(): boolean {
  const connection = (navigator as Navigator & { connection?: Connection }).connection
  return !!connection && (connection.saveData === true || /2g/.test(connection.effectiveType ?? ''))
}

const idle = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => resolve(), { timeout: 1500 })
    } else {
      window.setTimeout(resolve, 200)
    }
  })

let started = false

/** `chunks` are the lazily loaded pages' importers, from App.tsx. */
export function warmUp(chunks: (() => Promise<unknown>)[]): void {
  if (started || frugal()) return
  started = true
  void (async () => {
    await whenQuiet()
    await idle()
    // The code first: it comes from the same host as the page, costs the
    // database nothing, and a page cannot open before it however much of its
    // data is already held.
    await Promise.allSettled(chunks.map((get) => get()))
    for (const read of readAhead()) {
      await whenQuiet()
      await idle()
      await read().catch(() => {})
    }
  })()
}
