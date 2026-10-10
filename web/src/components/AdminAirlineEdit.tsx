import { useState } from 'react'
import Modal from './Modal'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { forgetDivisions, useDivisions } from '../lib/data'
import type { Airline, Division } from '../lib/types'

const NO_DIVISIONS: Division[] = []

/**
 * What an admin can change about a carrier: what it is called, the paragraph
 * under the name, and which division it flies in.
 *
 * Everything else on the page — fleet, routes, hubs, fares — is scraped from
 * the game and rewritten by the next import, so editing it would produce a
 * value with a shelf life measured in days. The three here are the exceptions
 * because each is something the scrape gets wrong in a way no amount of
 * re-importing fixes.
 *
 * Name and description revert rather than blank: clearing the name restores
 * whatever the game calls the airline, and clearing the description restores
 * the generated one. The division reverts the same way — set it back to where
 * the game had it and the override is dropped entirely, rather than pinning
 * the carrier there for ever.
 *
 * Two RPCs, because they are genuinely different operations: a move rewrites
 * public.airlines so that every per-division total follows it, and reports
 * back that the network map is a rebuild behind. The edit does not.
 *
 * It appears only for an admin, and both RPCs check again on the server — the
 * hidden button is courtesy, not security.
 */
export default function AdminAirlineEdit({
  airline,
  onSaved,
}: {
  airline: Airline
  onSaved: (updated: Airline) => void
}) {
  const { resonant } = useAuth()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [division, setDivision] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moved, setMoved] = useState<string | null>(null)

  const isAdmin = resonant?.is_admin ?? false
  const divisions = useDivisions(isAdmin && open) ?? NO_DIVISIONS

  // Hooks above every return, always.
  if (!isAdmin) return null

  const start = () => {
    // Seed with what is overridden today, not with the generated text: the
    // boxes should be empty when nothing has been overridden, so that "empty"
    // consistently means "use what the game says".
    setName(airline.airline_name ?? '')
    setDescription(airline.description_is_custom ? (airline.description_md ?? '') : '')
    setDivision(airline.division_code)
    setError(null)
    setMoved(null)
    setOpen(true)
  }

  const save = async () => {
    setBusy(true)
    setError(null)
    const movingTo = division && division !== airline.division_code ? division : null
    try {
      // The edit first. If the move then fails, the carrier is still named
      // correctly and the error says the move did not happen — the other
      // order would leave it moved under a name the admin meant to change.
      const { error: editError } = await supabase.rpc('admin_update_airline', {
        p_uid: airline.uid,
        p_airline_name: name.trim() || null,
        p_description_md: description.trim() || null,
      })
      if (editError) throw new Error(editError.message)

      if (movingTo) {
        const { error: moveError } = await supabase.rpc('admin_move_airline', {
          p_uid: airline.uid,
          p_division_code: movingTo,
        })
        if (moveError) throw new Error(moveError.message)
      }

      // Read the carrier back rather than patching it together from two
      // returns: the division's name and colour both change with a move, and
      // the profile view is the thing that knows.
      const { data, error: readError } = await supabase
        .from('v_airline_profile')
        .select('*')
        .eq('uid', airline.uid)
        .maybeSingle()
      if (readError) throw new Error(readError.message)
      if (!data) throw new Error('The carrier was not returned after saving.')

      const updated = data as Airline
      onSaved(updated)

      // A move is worth a word before the modal goes away: the map will not
      // agree yet, and finding that out by noticing is a worse experience
      // than being told.
      if (movingTo) {
        setMoved(updated.division_name)
        // Two divisions' carrier counts just changed, and the summary is kept
        // across pages now: drop it so the next reader asks again.
        forgetDivisions()
      }
      else setOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The change could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  const movingAway = division !== '' && division !== airline.division_code

  return (
    <>
      <button
        type="button"
        onClick={start}
        className="mono border border-[color:var(--color-warn)] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-warn transition-colors hover:bg-[color:var(--color-warn)] hover:text-[#0B0713]"
      >
        Edit as admin
      </button>

      {open && (
        <Modal
          wide
          title={`Edit ${airline.airline_name ?? airline.carrier_code}`}
          onClose={() => setOpen(false)}
        >
          {moved ? (
            <>
              <p className="text-sm leading-relaxed text-ink-dim">
                Moved to <span className="text-ink">{moved}</span>. The carrier
                page, the directory, search and every division total are already
                showing it there.
              </p>
              <p className="mt-3 text-sm leading-relaxed text-ink-dim">
                The route map still draws its routes in the old division's
                colour. That colouring is worked out across the whole network at
                once and is rebuilt on the next deploy — nothing is wrong with
                it in the meantime, it is just a rebuild behind.
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="mono mt-6 bg-accent px-5 py-2.5 text-[11px] uppercase tracking-[0.14em] text-[#0B0713] transition-opacity hover:opacity-90"
              >
                Done
              </button>
            </>
          ) : (
            <>
              <p className="mb-5 text-sm leading-relaxed text-ink-dim">
                Only these three. Everything else on a carrier's page comes from
                the game and is rewritten by the next import, so it is not
                editable here.
              </p>

              <label className="eyebrow mb-1.5 block text-ink-faint" htmlFor="admin-name">
                Airline name
              </label>
              <input
                id="admin-name"
                value={name}
                autoFocus
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="Leave empty to use the name from the game"
                className="mono w-full border border-edge bg-ground-2 px-3 py-2.5 text-ink outline-none focus:border-accent"
              />

              <label className="eyebrow mb-1.5 mt-5 block text-ink-faint" htmlFor="admin-division">
                Division
              </label>
              <select
                id="admin-division"
                value={division}
                onChange={(e) => setDivision(e.target.value)}
                className="w-full border border-edge bg-ground-2 px-3 py-2.5 text-ink outline-none focus:border-accent"
              >
                {divisions.length === 0 && (
                  <option value={airline.division_code}>{airline.division_name}</option>
                )}
                {divisions.map((d) => (
                  <option key={d.division_code} value={d.division_code}>
                    {d.division_name}
                  </option>
                ))}
              </select>

              {movingAway && (
                <div className="mt-2 border-l-2 border-l-[color:var(--color-warn)] pl-3">
                  <p className="text-[12px] leading-relaxed text-ink-dim">
                    Moving a carrier changes every per-division total it counts
                    towards, and the colour its routes are drawn in.
                  </p>
                  {airline.is_division_leader && (
                    <p className="mt-1.5 text-[12px] leading-relaxed text-warn">
                      This carrier is flagged as a division leader. That flag
                      comes from the game and is left alone here, so it will
                      still read as a leader after the move — worth correcting
                      in-game if it should not.
                    </p>
                  )}
                </div>
              )}

              <label className="eyebrow mb-1.5 mt-5 block text-ink-faint" htmlFor="admin-desc">
                Description
              </label>
              <textarea
                id="admin-desc"
                value={description}
                maxLength={4000}
                rows={8}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Leave empty to use the description generated from what this carrier flies"
                className="w-full border border-edge bg-ground-2 px-3 py-2.5 text-sm leading-relaxed text-ink outline-none focus:border-accent"
              />
              <p className="mt-1.5 text-[11px] text-ink-faint">
                {description.length}/4000 · empty restores the generated description
              </p>

              {error && (
                <p className="mt-4 border-l-2 border-l-[color:var(--color-danger)] pl-3 text-sm text-danger">
                  {error}
                </p>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void save()}
                  className="mono bg-accent px-5 py-2.5 text-[11px] uppercase tracking-[0.14em] text-[#0B0713] transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {busy ? 'Updating…' : 'Update'}
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="mono border border-edge px-5 py-2.5 text-[11px] uppercase tracking-[0.14em] text-ink-dim transition-colors hover:text-ink"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  )
}
