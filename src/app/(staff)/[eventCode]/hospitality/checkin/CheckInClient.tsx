'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { AlertTriangleIcon, SearchIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import { Segmented } from '@/components/ui/Segmented'
import { createClient } from '@/lib/supabase/client'
import { checkInRoom, checkOutRoom } from '@/lib/actions/event-day'
import { traceFetch } from '@/lib/perf'
import { queryKeys } from '@/lib/query/keys'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { initials } from '@/lib/ui/metrics'
import { formatDateTime } from '@/lib/utils'
import type { Database } from '@/lib/supabase/database.types'

type RoomAssignmentRow = Database['public']['Tables']['room_assignments']['Row']
type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']

interface CheckInRow {
  assignment: RoomAssignmentRow
  group: GuestGroupRow
  roomLabel: string
  occupiedByOther: string | null
  pendingDeliverables: string[]
}

export interface CheckInClientProps {
  eventId: string
  eventCode: string
}

/**
 * Check-in (SPEC-V3 §4).
 *
 * The door of the hotel: a family walks up, you find them, you tap once. So the
 * screen is a progress bar, a search, and rows — and every write is one tap
 * inside the family's sheet, with the same optimistic path and the same
 * deferred Undo as before.
 *
 * v3 SIMPLIFICATION, and what left the screen: the "Checked out" toggle chip
 * became a `Segmented` switch (it is a view of the same list, and a chip that is
 * really a switch is the exact confusion `Segmented` exists to prevent), the
 * per-row `Badge` wall became the row's one status word, the explanatory card
 * prose is gone, the "In"/"Out" pills are gone, and the skeleton is the shared
 * `LoadingRows`.
 *
 * WHAT DID NOT CHANGE: the query and its five parallel reads, `checkInRoom` /
 * `checkOutRoom`, the `deferUntilCommit` decision and its reasoning (neither RPC
 * has a reverse, so Undo must mean NOTHING WAS SENT), the double-tap guard, the
 * in-flight row lock, the offline queueing and every message the user can see
 * when a write fails.
 *
 * WHY THERE IS NO BOTTOM BAR HERE, unlike Rooms. A bar would have to act on ONE
 * family, and the only family this screen can name without being told is the
 * first in the list — which is not the family standing at the desk. A control
 * that checks in whoever happens to be first is worse than no control, so the
 * screen's single primary lives in the sheet, on the family you tapped.
 */
export function CheckInClient({ eventId, eventCode }: CheckInClientProps) {
  const supabase = useMemo(() => createClient(), [])

  const [search, setSearch] = useState('')
  const [view, setView] = useState<'to_check_in' | 'checked_out'>('to_check_in')
  const [openRowId, setOpenRowId] = useState<string | null>(null)

  const {
    data: rows,
    isPending: loading,
    error,
    refetch,
  } = useQuery({
    queryKey: queryKeys.hospitality.checkIn(eventId),
    queryFn: async () => {
      const result = await traceFetch('checkin :: load', () =>
        Promise.all([
          supabase.from('room_assignments').select('*').eq('event_id', eventId).is('released_at', null),
          supabase.from('guest_groups').select('*').eq('event_id', eventId),
          supabase.from('rooms').select('*').eq('event_id', eventId),
          supabase.from('hotels').select('*').eq('event_id', eventId),
          supabase.from('deliverables').select('*').eq('event_id', eventId),
        ]),
      )

      const [{ data: assignments, error: aErr }, { data: groups }, { data: rooms }, { data: hotels }, { data: deliverables }] =
        result

      if (aErr) {
        throw new Error('Could not load check-ins. Check your connection and try again.')
      }

      const groupById = new Map((groups ?? []).map((g) => [g.id, g]))
      const roomById = new Map((rooms ?? []).map((r) => [r.id, r]))
      const hotelById = new Map((hotels ?? []).map((h) => [h.id, h]))

      const roomLabel = (roomId: string) => {
        const room = roomById.get(roomId)
        if (!room) return ''
        const hotel = hotelById.get(room.hotel_id)
        return [hotel?.name, room.room_number].filter(Boolean).join(' ')
      }

      // Who is currently occupying each room (checked in, not out, and not
      // soft-released — a released assignment is the explicit "done with the
      // room" signal and must not block a fresh check-in).
      const occupantByRoom = new Map<string, { assignmentId: string; headName: string }>()
      for (const a of assignments ?? []) {
        if (a.checked_in_at === null || a.checked_out_at !== null || a.released_at !== null) continue
        const group = groupById.get(a.group_id)
        if (group) occupantByRoom.set(a.room_id, { assignmentId: a.id, headName: group.head_name })
      }

      const pendingByGroup = new Map<string, string[]>()
      for (const d of deliverables ?? []) {
        if (d.status === 'delivered') continue
        const list = pendingByGroup.get(d.group_id) ?? []
        list.push(d.kind === 'hamper' ? 'Hamper' : 'Return gift')
        pendingByGroup.set(d.group_id, list)
      }

      // Group assignments by family so each family has one check-in row
      const assignmentsByGroup = new Map<string, typeof assignments>()
      for (const a of assignments ?? []) {
        if (!groupById.has(a.group_id)) continue
        const list = assignmentsByGroup.get(a.group_id) ?? []
        list.push(a)
        assignmentsByGroup.set(a.group_id, list)
      }

      const rows: CheckInRow[] = []
      for (const [groupId, groupAssignments] of assignmentsByGroup.entries()) {
        const group = groupById.get(groupId)!
        // Use earliest assignment as primary identity and timestamp anchor
        const primary = groupAssignments[0]
        let otherOccupant: string | null = null
        for (const a of groupAssignments) {
          const occupant = occupantByRoom.get(a.room_id)
          if (occupant && occupant.assignmentId !== a.id) {
            otherOccupant = occupant.headName
            break
          }
        }
        const roomLabels = groupAssignments.map((a) => roomLabel(a.room_id))
        const combinedRoomLabel = roomLabels.join(' · ')

        rows.push({
          assignment: primary,
          group,
          roomLabel: combinedRoomLabel,
          occupiedByOther: otherOccupant,
          pendingDeliverables: pendingByGroup.get(groupId) ?? [],
        })
      }

      return rows
    },
  })

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  /**
   * The check-in / check-out write, through V3's optimistic path.
   *
   * DEFERRED, not immediate, and the reason is in the database: neither
   * `check_in_room` nor `check_out_room` has a reverse. Both only ever SET a
   * timestamp and never clear one (20260806160000_event_day_state.sql:137 and
   * :216), so "undo a check-in" cannot be done by calling check-out — that would
   * leave the row reading "Out", a different wrong state, and the runner would
   * watch their undo produce something they never asked for.
   *
   * Holding the write until the undo window closes makes Undo mean NOTHING WAS
   * SENT, which is the only honest version. The accepted cost: a check-in the
   * app dies on before the window closes never reaches the server and has to be
   * tapped again. That is a better failure than a lying Undo.
   */
  type CheckVars = { groupId: string; assignmentId: string; headName: string }

  const checkIn = useOptimisticAction<CheckInRow[], CheckVars, RoomAssignmentRow>({
    queryKey: queryKeys.hospitality.checkIn(eventId),
    callSite: 'checkInRoom',
    deferUntilCommit: true,
    message: (v) => `${v.headName} · Checked in`,
    apply: (prev, v) =>
      (prev ?? []).map((r) =>
        r.assignment.id === v.assignmentId
          ? {
              ...r,
              assignment: {
                ...r.assignment,
                checked_in_at: new Date().toISOString(),
                checked_out_at: null,
              },
            }
          : r,
      ),
    action: async (v) => {
      const result = await checkInRoom(eventId, eventCode, v.groupId)
      if (!result.ok) return { ok: false, message: result.message }
      // `EventDayResult` is shared by all four event-day actions, so the ok
      // branch is a union and `assignment` is not narrowed by `ok` alone.
      if (!('assignment' in result)) {
        return { ok: false, message: 'The server did not confirm that check-in.' }
      }
      return { ok: true, data: result.assignment }
    },
    // The RPC returns the real row, including the SERVER's clock — so the
    // optimistic phone-clock timestamp is replaced rather than left to age into
    // a lie. No round trip needed.
    reconcile: (server, optimistic) =>
      optimistic.map((r) => (r.assignment.id === server.id ? { ...r, assignment: server } : r)),
    queue: { eventId, kind: 'room-check-in', what: 'check-ins' },
  })

  const checkOut = useOptimisticAction<CheckInRow[], CheckVars, RoomAssignmentRow>({
    queryKey: queryKeys.hospitality.checkIn(eventId),
    callSite: 'checkOutRoom',
    deferUntilCommit: true,
    message: (v) => `${v.headName} · Checked out`,
    apply: (prev, v) =>
      (prev ?? []).map((r) =>
        r.assignment.id === v.assignmentId
          ? {
              ...r,
              assignment: { ...r.assignment, checked_out_at: new Date().toISOString() },
            }
          : r,
      ),
    action: async (v) => {
      const result = await checkOutRoom(eventId, eventCode, v.groupId)
      if (!result.ok) return { ok: false, message: result.message }
      if (!('assignment' in result)) {
        return { ok: false, message: 'The server did not confirm that check-out.' }
      }
      return { ok: true, data: result.assignment }
    },
    reconcile: (server, optimistic) =>
      optimistic.map((r) => (r.assignment.id === server.id ? { ...r, assignment: server } : r)),
    queue: { eventId, kind: 'room-check-out', what: 'check-outs' },
  })

  // The first failed write wins the banner. Two errors at once is possible in
  // principle; showing the newer one silently would hide the other.
  const writeError = checkIn.lastError ?? checkOut.lastError

  // T7 / R8: a write that could not reach the server is "saved on this phone" —
  // never silently dropped, and never called saved.
  const queuedOnPhone = checkIn.syncState === 'queued' || checkOut.syncState === 'queued'
  const queuedCount = checkIn.queuedCount + checkOut.queuedCount

  /**
   * Is the row being written right now?
   *
   * WHY THIS EXISTS. This row renders ONE action that flips from "Check in" to
   * "Check out" the instant the state changes — and with an optimistic write
   * that state changes on the tap, not after the round trip. A fast double-tap
   * on the same spot would therefore commit a check-in and then a check-out,
   * leaving the family checked in and straight back out (room reads free) while
   * the first write may still be in flight.
   *
   * DERIVED, not stored. The condition also requires the hook to still be busy,
   * so it clears itself the moment the write settles.
   */
  const [pendingRowId, setPendingRowId] = useState<string | null>(null)
  const anyWriteInFlight = checkIn.syncState === 'sending' || checkOut.syncState === 'sending'
  const rowBusy = (assignmentId: string) => anyWriteInFlight && pendingRowId === assignmentId

  const checkedInRows = useMemo(
    () => (rows ?? []).filter((r) => r.assignment.checked_in_at !== null && r.assignment.checked_out_at === null),
    [rows],
  )

  const listRows = useMemo(() => {
    const all = rows ?? []
    const base = view === 'checked_out'
      ? all.filter((r) => r.assignment.checked_out_at !== null)
      : all.filter((r) => r.assignment.checked_out_at === null)
    if (!search.trim()) return base
    const q = search.trim().toLowerCase()
    return base.filter(
      (r) =>
        r.group.head_name.toLowerCase().includes(q) || r.roomLabel.toLowerCase().includes(q),
    )
  }, [rows, search, view])

  /** The family whose sheet is open, if any. */
  const openRow = (rows ?? []).find((r) => r.assignment.id === openRowId) ?? null

  function handleCheckIn(row: CheckInRow) {
    setPendingRowId(row.assignment.id)
    checkIn.run({
      groupId: row.group.id,
      assignmentId: row.assignment.id,
      headName: row.group.head_name,
    })
    setOpenRowId(null)
  }

  function handleCheckOut(row: CheckInRow) {
    setPendingRowId(row.assignment.id)
    checkOut.run({
      groupId: row.group.id,
      assignmentId: row.assignment.id,
      headName: row.group.head_name,
    })
    setOpenRowId(null)
  }

  if (loadError && !rows) {
    return (
      <EmptyState
        title="Could not load check-ins"
        description={loadError}
        action={<Button onClick={() => void refetch()}>Try again</Button>}
      />
    )
  }

  if (loading || !rows) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-24 rounded-2xl border border-rule-strong bg-surface" />
        <LoadingRows count={5} />
      </div>
    )
  }

  const arrivedCount = checkedInRows.length
  const checkedOutCount = rows.filter((r) => r.assignment.checked_out_at !== null).length
  const expected = rows.length

  return (
    <div className="flex flex-col gap-5 pb-nav">
      <section className="flex flex-col gap-3 rounded-2xl border border-rule-strong bg-surface p-4 shadow-e1">
        <Progress label="Families arrived" done={arrivedCount} total={expected} tone="brand" />
      </section>

      <label className="flex min-h-12 items-center gap-2 rounded-xl border border-rule-strong bg-surface px-3.5">
        <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
        <span className="sr-only">Search check-ins</span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a family or a room"
          className="min-w-0 flex-1 bg-transparent py-2.5 text-base text-ink outline-none placeholder:text-subtle"
        />
      </label>

      {loadError ? (
        <div className="flex flex-col gap-2">
          <p
            role="alert"
            className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
          >
            {loadError}
          </p>
          {/no allocated room/i.test(loadError) ? (
            // The board, not the retired `/rooms/allocate` screen: v3's
            // allocation flow is Auto-fill on the Rooms board, so sending the
            // runner to the v1 allocator would drop them out of the look and
            // out of the flow that replaced it.
            <LinkButton fullWidth variant="secondary" href={`/${eventCode}/hospitality/rooms`}>
              Go to rooms
            </LinkButton>
          ) : null}
        </div>
      ) : null}

      {writeError ? (
        // The write was applied and then corrected. Say so, in the house voice —
        // a silent revert reads as the app randomly undoing the user's work
        // (docs/INTERACTION-CONTRACT.md T2, UX-RULES R6).
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {writeError}
        </p>
      ) : null}

      {queuedOnPhone ? (
        <p
          role="status"
          className="rounded-xl border border-rule-strong bg-amber-tint px-3.5 py-3 text-sm font-medium text-ledger-amber"
        >
          Saved on this phone — it will send when there is signal.
          {queuedCount > 1 ? ` (${queuedCount} waiting)` : ''}
        </p>
      ) : null}

      {expected === 0 ? (
        <EmptyState
          title="No family has a room yet"
          description="Allocate rooms first — then every family appears here to check in."
          action={
            <LinkButton fullWidth href={`/${eventCode}/hospitality/rooms`}>
              Go to rooms
            </LinkButton>
          }
        />
      ) : (
        <>
          {/* Two views of the same list, so a switch — not a chip. Exactly one
              side is on and there is no "neither". */}
          <Segmented
            label="Which families"
            value={view}
            onChange={setView}
            options={[
              { value: 'to_check_in', label: 'To check in', count: expected - arrivedCount },
              { value: 'checked_out', label: 'Checked out', count: checkedOutCount },
            ]}
          />

          {listRows.length === 0 ? (
            <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
              {search.trim()
                ? 'Nothing matches that search.'
                : view === 'checked_out'
                  ? 'Nobody has checked out yet.'
                  : 'Every family with a room has arrived.'}
            </p>
          ) : (
            <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
              {listRows.map((row) => {
                const isIn =
                  row.assignment.checked_in_at !== null && row.assignment.checked_out_at === null
                const isOut = row.assignment.checked_out_at !== null
                const meta = isOut
                  ? `Out ${clockTime(row.assignment.checked_out_at)}`
                  : isIn
                    ? `${row.roomLabel} · in ${clockTime(row.assignment.checked_in_at)}`
                    : row.roomLabel
                return (
                  <li key={row.assignment.id}>
                    <Row
                      heading={row.group.head_name}
                      meta={meta}
                      initials={initials(row.group.head_name)}
                      status={isOut ? 'Out' : isIn ? 'In' : 'Not yet'}
                      tone={isOut ? 'neutral' : isIn ? 'done' : 'waiting'}
                      onPress={() => setOpenRowId(row.assignment.id)}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      {/* Every action for one family, in a sheet: who they are, the room, the
          two things that block a check-in, and the ONE commit. */}
      <BottomSheet
        open={openRow !== null}
        onClose={() => setOpenRowId(null)}
        label={openRow ? openRow.group.head_name : 'Family'}
      >
        {openRow === null ? null : (
          <div className="flex flex-col gap-4">
            <div className="min-w-0">
              <h2 className="truncate font-display text-2xl leading-tight font-semibold text-ink">
                {openRow.group.head_name}
              </h2>
              <p className="mt-1 text-sm leading-snug text-muted">
                {openRow.roomLabel}
                {openRow.assignment.checked_in_at
                  ? ` · in ${formatDateTime(openRow.assignment.checked_in_at)}`
                  : ''}
                {openRow.assignment.checked_out_at
                  ? ` · out ${formatDateTime(openRow.assignment.checked_out_at)}`
                  : ''}
              </p>
            </div>

            {openRow.occupiedByOther ? (
              <p className="flex items-center gap-2 rounded-xl bg-red-tint px-3.5 py-2.5 text-sm font-medium text-ledger-red">
                <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                Room occupied by {openRow.occupiedByOther} — check them out first.
              </p>
            ) : null}

            {openRow.pendingDeliverables.length > 0 && openRow.assignment.checked_in_at ? (
              <p className="flex items-center gap-2 rounded-xl bg-amber-tint px-3.5 py-2.5 text-sm font-medium text-ledger-amber">
                <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                Still pending: {openRow.pendingDeliverables.join(', ')}
              </p>
            ) : null}

            {/* Three states, one control: already out (nothing to do), in
                (Check out), not yet (Checked in). */}
            {openRow.assignment.checked_out_at !== null ? null : openRow.assignment.checked_in_at !==
              null ? (
              // No confirmation dialog. R5: undo, do not confirm — and the undo
              // is real, because the check-out is held until the window closes.
              <Button
                variant="secondary"
                size="lg"
                fullWidth
                onClick={() => handleCheckOut(openRow)}
                disabled={Boolean(openRow.occupiedByOther) || rowBusy(openRow.assignment.id)}
              >
                Check out
              </Button>
            ) : (
              <Button
                size="lg"
                fullWidth
                onClick={() => handleCheckIn(openRow)}
                disabled={rowBusy(openRow.assignment.id)}
              >
                Checked in
              </Button>
            )}
          </div>
        )}
      </BottomSheet>
    </div>
  )
}

/** "16:05" — the time only, for a row's one meta line. */
function clockTime(value: string | null | undefined): string {
  if (!value) return '—'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at)
}

export default CheckInClient
