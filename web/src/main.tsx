import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { loadPage, pageFor } from './pages'
import { openCarrier } from './lib/carrierPage'
import { MAINTENANCE_LOCK_UNTIL } from './lib/site'
import { isConfigured } from './lib/supabase'
import './styles.css'

// Before React starts, not after it has rendered and run its effects: the page
// the address bar names is fetched now, and a carrier's reads go out now, so
// both are under way while the first render is still being worked out.
//
// Not while the maintenance lock is up, though: App.tsx promises that nothing
// behind the lock runs, and that includes this.
const locked = !!MAINTENANCE_LOCK_UNTIL && new Date(MAINTENANCE_LOCK_UNTIL).getTime() > Date.now()
const hash = window.location.hash
const page = locked ? null : pageFor(hash)
const arriving = page ? loadPage(page).catch(() => {}) : null
if (page === 'airline' && isConfigured) {
  const [, code, slug] = hash.replace(/^#\/?/, '').split('?')[0].split('/')
  try {
    void openCarrier(decodeURIComponent(code), decodeURIComponent(slug), true).catch(() => {})
  } catch {
    /* a malformed escape in the address: the page will say what it finds */
  }
}

const start = () =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

// A deep link's first render waits for its page's file, so the page is in that
// render and its reads go out with the shell's. Rendering first and letting
// the page follow cost two extra passes -- 60 to 90 ms before the page asked
// for anything, measured on the division page. index.html has been fetching
// the file since before this script arrived, so the wait is normally nothing;
// the second is the limit on how long a slow one may hold the shell back.
if (arriving) void Promise.race([arriving, new Promise((r) => setTimeout(r, 1000))]).then(start)
else start()
