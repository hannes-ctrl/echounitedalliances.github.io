import { useEffect, useState } from 'react'
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import Home from './pages/Home'
import { PAGE_NAMES, arrivedPage, loadPage, type PageName } from './pages'
import { warmUp } from './lib/warmup'
import { Loading } from './components/ui'
import { MAINTENANCE_LOCK_UNTIL, SITE, discordConfigured } from './lib/site'
import { useOnlineCount } from './lib/discordWidget'
import { useSiteVisitorCount } from './lib/presence'
import { num } from './lib/format'
import { useAirportCount, useCarrierCount, useDivisionCount } from './lib/carriers'
import { AuthProvider, useAuth } from './lib/auth'
import AdvisoryBar from './components/AdvisoryBar'
import NavGroup from './components/NavGroup'
import { NAV } from './lib/nav'
import MobileMenu from './components/MobileMenu'
import EchoMark from './components/EchoMark'
import Welcome from './components/Welcome'
import MaintenanceLock from './components/MaintenanceLock'

/**
 * HashRouter, not BrowserRouter. GitHub Pages has no server to rewrite unknown
 * paths back to index.html, so a deep link like /d/kyra/emirates would 404 on
 * refresh. The hash keeps every route client-side.
 */

/**
 * Home is in the first script; every other page is its own file.
 *
 * The site shipped as one 751 kB script (220 kB over the wire), so a visitor
 * reading the front page had also downloaded and parsed the booking flow, the
 * admin screens and three policy documents before anything was drawn. Each
 * page is now fetched when it is first needed -- which in practice is while
 * the welcome plays: lib/warmup.ts asks for all of them as soon as the page on
 * screen has finished its own reading, and index.html and main.tsx ask for
 * the one in the address bar straight away. See pages/index.ts.
 *
 * Not React.lazy. Once a Suspense fallback has been shown React holds the
 * real content back for 300 ms so that spinners do not flicker, which put
 * 300 ms on every deep link (measured: the directory at 620 ms against 300).
 * This draws the page in the same render if its file is here, and in the
 * render after it arrives if not, with nothing in between.
 */
function page<N extends PageName>(
  name: N,
  pick: (module: NonNullable<ReturnType<typeof arrivedPage<N>>>) => React.ComponentType,
) {
  return function Page() {
    const [, arrive] = useState(0)
    const module = arrivedPage(name)
    useEffect(() => {
      if (module) return
      let cancelled = false
      void loadPage(name).then(() => {
        if (!cancelled) arrive((n) => n + 1)
      })
      return () => {
        cancelled = true
      }
    }, [module])
    // Seen only if a page is opened before its file has arrived, which takes
    // clicking through the welcome on a slow connection.
    if (!module) return <div className="min-h-[60vh]"><Loading /></div>
    const Component = pick(module)
    return <Component />
  }
}

const About = page('about', (m) => m.default)
const Activities = page('activities', (m) => m.default)
const Divisions = page('divisions', (m) => m.default)
const DivisionPage = page('division', (m) => m.default)
const AirlinePage = page('airline', (m) => m.default)
const Directory = page('directory', (m) => m.default)
const AirportPage = page('airport', (m) => m.default)
const SearchResults = page('search', (m) => m.default)
const Book = page('book', (m) => m.default)
const Trips = page('trips', (m) => m.default)
const NetworkPage = page('network', (m) => m.default)
const Resonance = page('resonance', (m) => m.default)
const News = page('news', (m) => m.default)
const RoundTheWorld = page('rtw', (m) => m.default)
const Terms = page('policy', (m) => m.Terms)
const Conduct = page('policy', (m) => m.Conduct)
const Privacy = page('policy', (m) => m.Privacy)


/** The live count from Discord's public widget. Renders nothing until it loads. */
function OnlineBadge() {
  const onlineCount = useOnlineCount()
  if (onlineCount == null) return null
  return (
    <div className="mono flex items-center gap-1.5 border border-edge px-2.5 py-1.5 text-[11px] text-ink-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {num(onlineCount)} online
    </div>
  )
}

/** How many tabs have the site open right now, via Supabase Presence. */
function SiteVisitorBadge() {
  const visitorCount = useSiteVisitorCount()
  if (visitorCount == null) return null
  return (
    <div className="mono flex items-center gap-1.5 border border-edge px-2.5 py-1.5 text-[11px] text-ink-faint">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan" />
      {num(visitorCount)} on site
    </div>
  )
}

/** Signed out it reads "Resonance"; signed in it is your name. */
function AccountLink({ block = false }: { block?: boolean }) {
  const { user, resonant } = useAuth()
  const label = user ? (resonant?.display_name || 'Account') : 'Resonance'
  return (
    <NavLink
      to="/resonance"
      className={({ isActive }) =>
        `mono border px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors ${
          block ? 'block text-center' : 'ml-1'
        } ${
          isActive
            ? 'border-[color:var(--color-cyan)] text-cyan'
            : 'border-edge text-ink-dim hover:border-accent hover:text-ink'
        }`
      }
    >
      {label}
    </NavLink>
  )
}

/**
 * Three links, a button and an account chip come to 526px, which does not fit
 * a 390px phone -- and because the header is the same on every route, that one
 * row was making the WHOLE SITE scroll sideways on mobile. Above 900px it is
 * the row it always was; below, the links fold into a menu and only the two
 * things a visitor actually came for stay out: Discord, and their account.
 */
function MenuButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="site-menu"
      aria-label={open ? 'Close menu' : 'Open menu'}
      className="mono flex h-9 w-9 shrink-0 items-center justify-center border border-edge text-ink-dim transition-colors hover:border-accent hover:text-ink lg:hidden"
    >
      <svg width="15" height="15" viewBox="0 0 15 15" aria-hidden="true">
        {open ? (
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="3" y1="3" x2="12" y2="12" />
            <line x1="12" y1="3" x2="3" y2="12" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
            <line x1="2" y1="4" x2="13" y2="4" />
            <line x1="2" y1="7.5" x2="13" y2="7.5" />
            <line x1="2" y1="11" x2="13" y2="11" />
          </g>
        )}
      </svg>
    </button>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const carrierCount = useCarrierCount()
  const airportCount = useAirportCount()
  const divisionCount = useDivisionCount()
  const { pathname } = useLocation()
  // Following a link should close the menu, or the next page opens behind it.
  useEffect(() => setOpen(false), [pathname])
  // Once, after the first page is up: read ahead while the welcome plays.
  useEffect(() => warmUp(PAGE_NAMES.map((name) => () => loadPage(name))), [])

  return (
    <div className="min-h-screen">
      {/* The advisory outranks the alliance's own chrome while travel is
          disrupted, so it sits above the bar rather than inside it. Both
          share one sticky wrapper: two elements pinned to top-0 would
          simply overlap. */}
      <div className="sticky top-0 z-40">
        <AdvisoryBar onHome={pathname === '/'} />
        <header className="border-b border-edge-soft bg-[color:var(--color-ground)]/88 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center gap-x-3 px-4 py-2.5 sm:px-5 sm:py-3">
          <Link to="/" className="flex items-baseline gap-2.5">
            {/* The wing, not a coloured square standing in for it. */}
            <EchoMark height={17} color="var(--color-ink)" />
            <span className="wordmark text-[21px]">Echo</span>
            <span className="wordmark-sub hidden text-[9.5px] text-ink-faint sm:inline">
              United Alliances
            </span>
          </Link>
          <nav className="ml-auto hidden items-center gap-1 lg:flex">
            {NAV.map((l) =>
              l.children ? (
                <NavGroup key={l.to} item={l} />
              ) : (
                <NavLink
                  key={l.to}
                  to={l.to}
                  className={({ isActive }) =>
                    `mono px-2.5 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors ${
                      isActive ? 'text-cyan' : 'text-ink-faint hover:text-ink-dim'
                    }`
                  }
                >
                  {l.label}
                </NavLink>
              ),
            )}
            <div className="ml-2 flex items-center gap-2">
              <OnlineBadge />
              <SiteVisitorBadge />
            </div>
            {discordConfigured && (
              <a
                href={SITE.discordInvite}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary ml-2 !px-4 !py-2"
              >
                Join Discord
              </a>
            )}
            <AccountLink />
          </nav>

          {/* the phone header: Discord stays out, everything else folds in */}
          <div className="ml-auto flex items-center gap-2 lg:hidden">
            {discordConfigured && (
              <a
                href={SITE.discordInvite}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-primary !px-3 !py-1.5 !text-[10px]"
              >
                Discord
              </a>
            )}
            <MenuButton open={open} onToggle={() => setOpen((o) => !o)} />
          </div>
        </div>

        </header>
      </div>

      <MobileMenu
        open={open}
        onClose={() => setOpen(false)}
        links={NAV}
        badges={
          <>
            <OnlineBadge />
            <SiteVisitorBadge />
          </>
        }
        account={<AccountLink block />}
      />

      <main>{children}</main>

      <footer className="mt-24 border-t border-edge-soft">
        <div className="mx-auto flex max-w-[1180px] flex-col gap-2 px-5 py-8 text-[12px] text-ink-faint sm:flex-row sm:justify-between">
          <span>
            Echo United Alliances · a virtual airline group in{' '}
            <span className="text-ink-dim">The Airline Simulator</span>
          </span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* This was hand-counted, with a note to re-check it on every
                rebuild. Nobody did: the 16 September 2026 scrape left it
                claiming 602 carriers and 2,186 airports against 583 and 2,180.
                It reads the same shared counts as the rest of the site now. */}
            <span className="mono">
              {num(carrierCount)} carriers · {divisionCount} divisions · {num(airportCount)} airports
            </span>
            <Link to="/terms" className="hover:text-ink-dim">
              Terms
            </Link>
            <Link to="/conduct" className="hover:text-ink-dim">
              Code of conduct
            </Link>
            <Link to="/privacy" className="hover:text-ink-dim">
              Privacy
            </Link>
            {discordConfigured && (
              <a
                href={SITE.discordInvite}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-cyan"
              >
                Join on Discord ↗
              </a>
            )}
          </div>
        </div>
      </footer>
    </div>
  )
}

const lockUntil = MAINTENANCE_LOCK_UNTIL ? new Date(MAINTENANCE_LOCK_UNTIL) : null

export default function App() {
  // Nothing past this point runs while the lock is up: no auth, no router,
  // no data fetch. See lib/site.ts for how to end it early or move it.
  const [locked, setLocked] = useState(() => !!lockUntil && lockUntil.getTime() > Date.now())
  if (locked && lockUntil) {
    return <MaintenanceLock until={lockUntil} onPass={() => setLocked(false)} />
  }

  return (
    <AuthProvider>
      <Welcome />
      <HashRouter>
        <Shell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/about" element={<About />} />
          <Route path="/activities" element={<Activities />} />
          <Route path="/divisions" element={<Divisions />} />
          <Route path="/d/:code" element={<DivisionPage />} />
          <Route path="/d/:code/:slug" element={<AirlinePage />} />
          <Route path="/airlines" element={<Directory />} />
          <Route path="/airports/:iata" element={<AirportPage />} />
          <Route path="/network" element={<NetworkPage />} />
          <Route path="/search" element={<SearchResults />} />
          <Route path="/book" element={<Book />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/resonance" element={<Resonance />} />
          <Route path="/news" element={<News />} />
          <Route path="/rtw" element={<RoundTheWorld />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/conduct" element={<Conduct />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route
            path="*"
            element={
              <div className="mx-auto max-w-[1180px] px-5 py-24 text-center">
                <h1 className="display text-4xl">Off the route map</h1>
                <p className="mt-3 text-ink-dim">That page is not in the network.</p>
                <Link to="/" className="mono mt-6 inline-block text-cyan">
                  ← Back to the alliance
                </Link>
              </div>
            }
          />
        </Routes>
        </Shell>
      </HashRouter>
    </AuthProvider>
  )
}
