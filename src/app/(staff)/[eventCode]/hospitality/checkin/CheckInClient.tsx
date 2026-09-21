'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Badge } from '@/components/ui/Badge'
import { SearchIcon, CheckCircleIcon, AlertTriangleIcon } from '@/components/icons'
import { LinkButton } from '@/components/ui/LinkButton'
import { createClient } from '@/lib/supabase/client'
import { checkInRoom, checkOutRoom } from '@/lib/actions/event-day'
import { traceFetch } from '@/lib/perf'
import { queryKeys } from '@/lib/query/keys'
import { useOptimisticAction } from '@/lib/mutate/useOptimisticAction'
import { cn, formatDateTime } from '@/lib/utils'
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

export function CheckInClient({ eventId, eventCode }: CheckInClientProps) {
  const supabase = useMemo(() => createClient(), [])

  const [search, setSearch] = useState('')
  const [onlyCheckedOut, setOnlyCheckedOut] = useState(false)

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
      // soft-released â€” a released assignment is the explicit "done with the
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

      return (assignments ?? [])
        .filter((a) => groupById.has(a.group_id))
        .map((a) => {
          const occupant = occupantByRoom.get(a.room_id)
          const otherOccupant =
            occupant && occupant.assignmentId !== a.id ? occupant.headName : null
          return {
            assignment: a,
            group: groupById.get(a.group_id)!,
            roomLabel: roomLabel(a.room_id),
            occupiedByOther: otherOccupant,
            pendingDeliverables: pendingByGroup.get(a.group_id) ?? [],
          }
        })
    },
  })

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  /**
   * The check-in / check-out write, through V3's optimistic path.
   *
   * DEFERRED, not immediate, and the reason is in the database: neither
   * `check_in_room` nor `check_out_room` has a reverse. Both only ever SET a
   * timestamp and never clear one (20260806160000_event_day_state.sql:137 and
   * :216), so "undo a check-in" cannot be done by calling check-out â€” that would
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
    message: (v) => `${v.headName} Â· Checked in`,
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
    // The RPC returns the real row, including the SERVER's clock â€” so the
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
    message: (v) => `${v.headName} Â· Checked out`,
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

  const filtered = useMemo(() => {
    if (!rows) return []
    let list = rows
    if (onlyCheckedOut) list = list.filter((r) => r.assignment.checked_out_at !== null)
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter((r) => r.group.head_name.toLowerCase().includes(q))
    }
    return list
  }, [rows, onlyCheckedOut, search])

  async function handleCheckIn(row: CheckInRow) {
    checkIn.run({
      groupId: row.group.id,
      assignmentId: row.assignment.id,
      headName: row.group.head_name,
    })
  }

  async function handleCheckOut(row: CheckInRow) {
    checkOut.run({
      groupId: row.group.id,
      assignmentId: row.assignment.id,
      headName: row.group.head_name,
    })
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
    // Loading: skeleton shaped like the check-in row cards, so the screen
    // does not flash "0 checked in" while the fetch is in flight.
    return (
      <div className="flex flex-col gap-4">
        <div>
          <div className="h-6 w-28 rounded bg-rule-strong" />
          <div className="mt-1.5 h-4 w-44 rounded bg-rule" />
        </div>
        <div className="h-12 rounded-xl border border-border bg-surface px-3" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="h-5 w-2/5 rounded bg-rule-strong" />
                <div className="mt-2 h-4 w-1/2 rounded bg-rule" />
              </div>
              <div className="h-6 w-16 rounded-full bg-rule" />
            </div>
            <div className="mt-3 h-11 w-full rounded-xl bg-rule" />
          </div>
        ))}
      </div>
    )
  }

  const checkedInCount = rows?.filter((r) => r.assignment.checked_in_at !== null && r.assignment.checked_out_at === null).length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Check in / out</h2>
        <p className="mt-0.5 text-sm text-muted">{checkedInCount} family{checkedInCount === 1 ? '' : 'ies'} currently checked in.</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-xl border border-border-strong bg-surface px-3">
          <SearchIcon className="h-5 w-5 shrink-0 text-muted" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by family name"
            className="min-h-12 w-full bg-transparent text-base text-fg placeholder:text-subtle focus:outline-none"
            aria-label="Search check-ins"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlyCheckedOut(!onlyCheckedOut)}
          className={cn(
            'tap min-h-12 self-start rounded-full border px-4 text-sm font-semibold active:opacity-80',
            onlyCheckedOut ? 'border-transparent bg-brand text-brand-fg' : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
          )}
        >
          Checked out
        </button>
      </div>

      {loadError ? (
        <div className="flex flex-col gap-2">
          <p role="alert" className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger">
            {loadError}
          </p>
          {/no allocated room/i.test(loadError) ? (
            <LinkButton fullWidth variant="secondary" href={`/${eventCode}/hospitality/rooms/allocate`}>
              Go to room allocation
            </LinkButton>
          ) : null}
        </div>
      ) : null}

      {writeError ? (
        // The write was applied and then corrected. Say so, in the house voice â€”
        // a silent revert reads as the app randomly undoing the user's work
        // (docs/INTERACTION-CONTRACT.md T2, UX-RULES R6).
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
        >
          {writeError}
        </p>
      ) : null}

      {rows && rows.length === 0 ? (
        <EmptyState
          title="No room assignments"
          description="No families are allocated to rooms yet â€” allocate rooms before check-in."
          action={
            <LinkButton fullWidth href={`/${eventCode}/hospitality/rooms/allocate`}>
              Go to room allocation
            </LinkButton>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="Nothing matches" description="No families match â€” try clearing the search." />
      ) : (
        <ul className="flex flex-col gap-2">
          {filtered.map((row) => {
            const isIn = row.assignment.checked_in_at !== null && row.assignment.checked_out_at === null
            const isOut = row.assignment.checked_out_at !== null
            return (
              <li key={row.assignment.id}>
                <Card className={cn(isOut && 'opacity-70')}>
                  <CardBody className="flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-fg">{row.group.head_name}</p>
                        <p className="mt-0.5 text-sm text-muted">{row.roomLabel}</p>
                        {isIn ? (
                          <p className="mt-0.5 text-xs text-success">
                            Checked in {formatDateTime(row.assignment.checked_in_at)}
                          </p>
                        ) : null}
                        {isOut ? (
                          <p className="mt-0.5 text-xs text-muted">
                            Checked out {formatDateTime(row.assignment.checked_out_at)}
                          </p>
                        ) : null}
                      </div>
                      {isIn ? (
                        <Badge tone="success">
                          <CheckCircleIcon className="h-3.5 w-3.5" />
                          In
                        </Badge>
                      ) : isOut ? (
                        <Badge tone="neutral">Out</Badge>
                      ) : null}
                    </div>

                    {row.occupiedByOther ? (
                      <p className="flex items-center gap-1.5 rounded-lg bg-tint-danger px-2.5 py-1.5 text-xs font-medium text-danger">
                        <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                        Room occupied by {row.occupiedByOther} â€” check them out first.
                      </p>
                    ) : null}

                    {row.pendingDeliverables.length > 0 && isIn ? (
                      <p className="flex items-center gap-1.5 rounded-lg bg-tint-warning px-2.5 py-1.5 text-xs font-medium text-warning">
                        <AlertTriangleIcon className="h-4 w-4 shrink-0" />
                        Still pending: {row.pendingDeliverables.join(', ')}
                      </p>
                    ) : null}

                    {isOut ? null : isIn ? (
                      // No confirmation dialog. R5: undo, do not confirm â€” and
                      // now the undo is real, because the check-out is held
                      // until the window closes. The old dialog asked "are you
                      // sure?" on every single check-out, which trains people to
                      // tap through it without reading.
                      //
                      // `occupiedByOther` still blocks it: that is not a "are
                      // you sure", it is a state the write cannot succeed in.
                      <Button
                        variant="secondary"
                        size="lg"
                        fullWidth
                        onClick={() => handleCheckOut(row)}
                        disabled={Boolean(row.occupiedByOther)}
                      >
                        Check out
                      </Button>
                    ) : (
                      <Button size="lg" fullWidth onClick={() => handleCheckIn(row)}>
                        Check in
                      </Button>
                    )}
                  </CardBody>
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

