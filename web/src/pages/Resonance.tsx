import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loading, NotConfigured } from '../components/ui'
import { isConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { PasswordCard, SignIn } from '../components/ResonanceAuth'
import AdminApplyModal from '../components/AdminApplyModal'
import AdminApplications from '../components/AdminApplications'
import AdminMemberSites from '../components/AdminMemberSites'
import AccountTrips from '../components/AccountTrips'
import type { AirportRow, Division } from '../lib/types'
import { num } from '../lib/format'
import { useCarrierCount } from '../lib/carriers'
import { useDivisions } from '../lib/data'

const NO_DIVISIONS: Division[] = []

/**
 * Resonance: sign in, keep a profile, and see every trip on the account.
 *
 * Sign-in is a password; the one-time email link that used to sit beside it
 * is gone. Email survives only as password reset, which is the sole way back
 * into an account nobody can sign into. The form lives in
 * components/ResonanceAuth; the site only ever holds the session.
 */
export default function Resonance() {
  const carrierCount = useCarrierCount()
  const { ready, user, resonant, recovering, endRecovery, signOut, refreshResonant } = useAuth()
  const [error, setError] = useState<string | null>(null)
  // Only once there is an account to show them to, as before.
  const divisions = useDivisions(!!resonant) ?? NO_DIVISIONS
  const [airportQuery, setAirportQuery] = useState('')
  const [airportHits, setAirportHits] = useState<AirportRow[]>([])
  const [saved, setSaved] = useState(false)
  const [showAdminModal, setShowAdminModal] = useState(false)

  useEffect(() => {
    if (airportQuery.length < 2) {
      setAirportHits([])
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      const { data } = await supabase.rpc('search_airports', {
        p_query: airportQuery,
        p_limit: 6,
      })
      if (!cancelled) setAirportHits((data as AirportRow[]) ?? [])
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [airportQuery])

  const saveProfile = async (patch: Record<string, string | null>) => {
    if (!resonant) return
    setSaved(false)
    const { error } = await supabase
      .from('resonants')
      .update(patch)
      .eq('resonant_id', resonant.resonant_id)
    if (!error) {
      await refreshResonant()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } else {
      setError(error.message)
    }
  }

  if (!isConfigured) return <NotConfigured />
  if (!ready) return <Loading label="Checking your session" />

  // ---------------------------------------------------------------- signed out
  if (!user) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-9 sm:px-5 sm:py-16">
        <p className="eyebrow text-cyan">Resonance</p>
        <h1 className="display mt-3 text-[clamp(36px,5vw,56px)]">
          The alliance, remembered
        </h1>
        <p className="mt-4 max-w-[58ch] text-lg text-ink-dim">
          A Resonance account keeps your trips together across all {num(carrierCount)} carriers,
          and remembers where you fly from. It is optional — you can search and
          book without one.
        </p>

        <SignIn />
      </div>
    )
  }

  // ----------------------------------------------------------------- signed in
  return (
    <div className="mx-auto max-w-[980px] px-4 py-8 sm:px-5 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow text-cyan">Resonance</p>
          <h1 className="display mt-3 text-[clamp(30px,4vw,46px)]">
            {resonant?.display_name || user.email}
          </h1>
          <p className="mono mt-1 text-[12px] text-ink-faint">
            {user.email}
            {resonant?.is_admin && (
              <span className="ml-3 border border-edge px-2 py-0.5 uppercase tracking-[0.12em] text-warn">
                Admin
              </span>
            )}
          </p>
        </div>
        <button
          onClick={() => void signOut()}
          className="btn btn-ghost"
        >
          Sign out
        </button>
      </div>

      {recovering && (
        <div className="mt-8">
          <PasswordCard highlight />
          <button
            onClick={endRecovery}
            className="mono mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-faint hover:text-ink-dim"
          >
            Skip for now
          </button>
        </div>
      )}

      {!resonant ? (
        <Loading label="Setting up your membership" />
      ) : (
        <>
          <section className="panel mt-8 p-5">
            <h2 className="mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
              Your details
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="eyebrow mb-1.5 block text-ink-faint">Display name</span>
                <input
                  defaultValue={resonant.display_name ?? ''}
                  onBlur={(e) => void saveProfile({ display_name: e.target.value || null })}
                  className="w-full border border-edge bg-ground-2 px-3 py-2.5 text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="eyebrow mb-1.5 block text-ink-faint">Home division</span>
                <select
                  defaultValue={resonant.home_division ?? ''}
                  onChange={(e) => void saveProfile({ home_division: e.target.value || null })}
                  className="w-full border border-edge bg-ground-2 px-3 py-2.5 text-ink outline-none focus:border-accent"
                >
                  <option value="">No preference</option>
                  {divisions.map((d) => (
                    <option key={d.division_code} value={d.division_code}>
                      {d.division_name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative block">
                <span className="eyebrow mb-1.5 block text-ink-faint">
                  Home airport{' '}
                  {resonant.home_airport && (
                    <span className="mono text-cyan">{resonant.home_airport}</span>
                  )}
                </span>
                <input
                  value={airportQuery}
                  onChange={(e) => setAirportQuery(e.target.value)}
                  placeholder="City or code"
                  className="w-full border border-edge bg-ground-2 px-3 py-2.5 text-ink outline-none placeholder:text-ink-faint focus:border-accent"
                />
                {airportHits.length > 0 && (
                  <ul className="panel absolute z-30 mt-1 max-h-64 w-full overflow-auto py-1">
                    {airportHits.map((a) => (
                      <li key={a.iata_code}>
                        <button
                          type="button"
                          onClick={() => {
                            void saveProfile({ home_airport: a.iata_code })
                            setAirportQuery('')
                            setAirportHits([])
                          }}
                          className="flex w-full items-baseline gap-3 px-3 py-2 text-left hover:bg-surface-2"
                        >
                          <span className="mono w-9 text-cyan">{a.iata_code}</span>
                          <span className="truncate text-sm text-ink">
                            {a.city_name ?? a.airport_name}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </label>
            </div>
            {saved && (
              <p className="mono mt-3 text-[11px] uppercase tracking-[0.12em] text-good">
                Saved
              </p>
            )}
          </section>

          {/* Both render nothing at all unless this account is an admin. */}
          <AdminApplications />
          <AdminMemberSites />

          {/* Not shown twice: while recovering it is already at the top. */}
          {!recovering && <PasswordCard />}

          {!resonant.is_admin && (
            <section className="panel mt-4 flex flex-wrap items-center justify-between gap-3 p-5">
              <div>
                <h2 className="mono text-[11px] uppercase tracking-[0.12em] text-ink-faint">
                  Board
                </h2>
                <p className="mt-2 max-w-[54ch] text-sm text-ink-dim">
                  Interested in helping run the alliance? Apply for admin —
                  it goes straight to the board on Discord.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAdminModal(true)}
                className="btn btn-ghost"
              >
                Apply for admin
              </button>
            </section>
          )}

          {/* Every booking kept on this account, and managing them. */}
          <AccountTrips />
        </>
      )}

      {showAdminModal && (
        <AdminApplyModal
          createAccount={false}
          initialEmail={user.email ?? ''}
          onClose={() => setShowAdminModal(false)}
        />
      )}
    </div>
  )
}
