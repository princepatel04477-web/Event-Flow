'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'

import { Badge } from '@/components/ui/Badge'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { PageTitle } from '@/components/ui/PageTitle'
import { SectionHead } from '@/components/ui/SectionHead'
import { StatusPill } from '@/components/ui/StatusPill'
import { Textarea } from '@/components/ui/Textarea'
import { BuildingIcon, PlusIcon, UploadIcon, ShieldAlertIcon } from '@/components/icons'
import {
  readRoomsGrid,
  moveGuestToRoom,
  releaseGuestFromRoom,
  assignGuestToRoom,
  ensureGroupMembers,
  type RoomsGridData,
  type RoomGridRow,
  type RoomGridGuest,
} from '@/lib/actions/rooms'
import { traceFetch } from '@/lib/perf'
import { ROOM_STATUS_LABELS, ROOM_STATUS_TONES, type RoomStatus } from '@/lib/status'
import { cn } from '@/lib/utils'
import type { TabAccess } from '@/components/nav/BottomTabs'

interface Props {
  eventId: string
  eventCode: string
  access: TabAccess
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'ready'; data: RoomsGridData }
  | { phase: 'error'; message: string }

/** Blocked is not a `RoomStatus` — it is a property of the room, not its fill. */
type TileState = RoomStatus | 'blocked'

function tileState(room: RoomGridRow): TileState {
  if (room.isBlocked) return 'blocked'
  if (room.isOverCapacity) return 'over_capacity'
  if (room.occupants.length === 0) return 'empty'
  if (room.occupants.length >= room.capacity) return 'full'
  return 'partly_full'
}

const TILE_LABELS: Record<TileState, string> = {
  ...ROOM_STATUS_LABELS,
  blocked: 'Blocked',
}

/**
 * The tile skin. Five states, five distinct fills — and every one of them
 * also differs in *shape* (hatching, outline weight, dot pattern), because a
 * grid of 168 tiles distinguished by hue alone is unreadable to the ~8% of
 * men with a colour vision deficiency, and this team is mostly men.
 */
const TILE_SKINS: Record<TileState, string> = {
  empty: 'border border-muted/35 bg-transparent text-muted',
  partly_full: 'border border-brand/45 bg-surface-2 text-ink',
  full: 'border border-ledger-green/45 bg-green-tint text-ink',
  over_capacity: 'border border-ledger-red bg-red-tint text-ink',
  blocked: 'border border-muted/25 text-muted/60',
}

const BLOCKED_HATCH =
  'repeating-linear-gradient(45deg, rgba(143,169,174,0.16) 0 2px, transparent 2px 5px)'

const DOT_TONES: Record<TileState, string> = {
  empty: 'text-muted/60',
  partly_full: 'text-brand',
  full: 'text-ledger-green',
  over_capacity: 'text-ledger-red',
  blocked: 'text-muted/50',
}

/**
 * The occupancy dots under the room number: one glyph per bed, filled if
 * taken. Over-capacity draws more filled dots than the room has beds, which
 * is the whole point — you can see the overflow, not just read about it.
 */
function occupancyDots(room: RoomGridRow): string {
  if (room.isBlocked) return '×'
  const beds = Math.max(room.capacity, room.occupants.length)
  let out = ''
  for (let i = 0; i < beds; i += 1) out += i < room.occupants.length ? '●' : '○'
  return out
}

interface UnplacedRow {
  guestId: string
  guestName: string
  groupId: string
  headName: string
}

/**
 * Group the unplaced list by family, head first, so members render nested
 * beneath the head. A family with no head row (import edge) still groups
 * under its groupId with all rows as members.
 */
function groupUnplacedByFamily(unplaced: UnplacedRow[]): {
  groupId: string
  head: UnplacedRow | null
  members: UnplacedRow[]
}[] {
  const byGroup = new Map<string, UnplacedRow[]>()
  for (const u of unplaced) {
    const list = byGroup.get(u.groupId) ?? []
    list.push(u)
    byGroup.set(u.groupId, list)
  }
  const out: { groupId: string; head: UnplacedRow | null; members: UnplacedRow[] }[] = []
  for (const [groupId, rows] of byGroup) {
    const head = rows.find((r) => r.guestName === r.headName) ?? rows[0]
    out.push({
      groupId,
      head,
      members: rows.filter((r) => r !== head),
    })
  }
  return out
}

/**
 * §5.4 — hamper colour coding per room.
 *
 * The house model is ONE hamper per GROUP (deliverables.group_id, guest_id
 * null), and a group can span multiple rooms. So a room's hamper state is:
 *   - 'delivered'   every occupant group's hamper is delivered
 *   - 'pending'     no occupant group's hamper is delivered
 *   - 'mixed'       some delivered, some not — the multi-room edge case the
 *                   runbook says to surface rather than silently resolve.
 * The mixed state is deliberately NOT green or red: it means "ask the team
 * which room the hamper went to", which is a different fact from either.
 */
type HamperState = 'delivered' | 'pending' | 'mixed'

function hamperState(room: RoomGridRow): HamperState {
  if (room.occupants.length === 0) return 'pending'
  const delivered = room.occupants.filter((o) => o.hamperDelivered).length
  if (delivered === room.occupants.length) return 'delivered'
  if (delivered === 0) return 'pending'
  return 'mixed'
}

const HAMPER_DOT: Record<HamperState, string> = {
  delivered: 'bg-ledger-green',
  pending: 'bg-ledger-red',
  mixed: 'bg-brand',
}

const HAMPER_LABEL: Record<HamperState, string> = {
  delivered: 'Hamper delivered',
  pending: 'Hamper not delivered',
  mixed: 'Mixed hamper state — some families in this room have theirs, some not',
}

export function RoomsGridClient({ eventId, eventCode, access }: Props) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [hotelIdx, setHotelIdx] = useState(0)
  const [openRoomId, setOpenRoomId] = useState<string | null>(null)
  const [selectedGuest, setSelectedGuest] = useState<RoomGridGuest | null>(null)
  const [selectedUnplaced, setSelectedUnplaced] = useState<string | null>(null)
  const [overrideRoom, setOverrideRoom] = useState<{ roomId: string; roomNumber: string } | null>(
    null,
  )
  const [overrideReason, setOverrideReason] = useState('')
  const [releaseReason, setReleaseReason] = useState<string | null>(null)
  const [releasingAssignment, setReleasingAssignment] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const data = await traceFetch('rooms :: readRoomsGrid', () => readRoomsGrid(eventId))
      setState({ phase: 'ready', data })
    } catch {
      setState({ phase: 'error', message: 'Could not load room data. Try again.' })
    }
  }, [eventId])

  useEffect(() => {
    void load()
  }, [load])

  // Memoised because `hotels` below derives from it: a fresh `[]` on every
  // render would rebuild the hotel tab list on every keystroke elsewhere.
  const rooms = useMemo(
    () => (state.phase === 'ready' ? state.data.rooms : []),
    [state],
  )

  // Hotels in first-appearance order, which is `rooms` order, which is
  // room_number order from the query — stable across reloads.
  const hotels = useMemo(() => {
    const seen = new Map<string, { hotelId: string; hotelName: string; count: number }>()
    for (const room of rooms) {
      const entry = seen.get(room.hotelId)
      if (entry) entry.count += 1
      else seen.set(room.hotelId, { hotelId: room.hotelId, hotelName: room.hotelName, count: 1 })
    }
    return [...seen.values()]
  }, [rooms])

  const activeHotel = hotels[Math.min(hotelIdx, Math.max(hotels.length - 1, 0))]
  const hotelRooms = activeHotel
    ? rooms.filter((r) => r.hotelId === activeHotel.hotelId)
    : []
  const openRoom = rooms.find((r) => r.roomId === openRoomId) ?? null

  const placing = selectedGuest ?? (selectedUnplaced ? { assignmentId: '' } : null)

  function clearSelection() {
    setSelectedGuest(null)
    setSelectedUnplaced(null)
    setActionError(null)
  }

  async function handleTapRoom(room: RoomGridRow) {
    // Placing mode: the tile is the drop target. Otherwise it opens detail.
    if (selectedGuest) {
      await attemptMove(selectedGuest.assignmentId, room.roomId, room.roomNumber)
      return
    }
    if (selectedUnplaced) {
      await attemptAssign(selectedUnplaced, room.roomId, room.roomNumber)
      return
    }
    setOpenRoomId(room.roomId)
  }

  async function attemptMove(assignmentId: string, roomId: string, roomNumber: string) {
    setLoading(true)
    setActionError(null)
    const result = await moveGuestToRoom(assignmentId, roomId, null)

    if (result.ok) {
      clearSelection()
      await load()
    } else if (result.code === 'capacity') {
      setOverrideRoom({ roomId, roomNumber })
      setOverrideReason('')
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  async function attemptAssign(guestId: string, roomId: string, roomNumber: string) {
    setLoading(true)
    setActionError(null)
    const result = await assignGuestToRoom(eventId, guestId, roomId, null)

    if (result.ok) {
      clearSelection()
      await load()
    } else if (result.code === 'capacity') {
      setOverrideRoom({ roomId, roomNumber })
      setOverrideReason('')
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  // Give an under-bedded family the member rows it is missing, on demand.
  //
  // readRoomsGrid is read-only (5412d97), so a family imported with one head
  // row and confirmed_pax 6 has exactly one guest row — and if that row is
  // already in a room, the family contributes NOTHING to the unplaced list.
  // The warning said "1 of 6 placed · 5 beds short" and there was no way to
  // act on it: the five missing people had no clickable representation
  // anywhere on the screen. This is the tap that creates them.
  //
  // It only materialises. Placing stays the existing two-tap flow, because
  // the missing members usually do NOT all fit one room — six people across
  // three doubles is the normal case, and a "place whole family here" button
  // would have to fail or overfill.
  async function attemptTopUp(groupId: string) {
    setLoading(true)
    setActionError(null)
    const result = await ensureGroupMembers(eventId, groupId)
    if (result.ok) {
      clearSelection()
      await load()
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  async function handleOverride() {
    if (!overrideRoom || !overrideReason.trim()) return

    setLoading(true)
    setActionError(null)

    const result = selectedGuest
      ? await moveGuestToRoom(selectedGuest.assignmentId, overrideRoom.roomId, overrideReason.trim())
      : selectedUnplaced
        ? await assignGuestToRoom(
            eventId,
            selectedUnplaced,
            overrideRoom.roomId,
            overrideReason.trim(),
          )
        : null

    if (result?.ok) {
      clearSelection()
      setOverrideRoom(null)
      setOverrideReason('')
      await load()
    } else if (result) {
      setActionError(result.error)
    }
    setLoading(false)
  }

  async function handleReleaseConfirm() {
    if (!releasingAssignment || !releaseReason?.trim()) return

    setLoading(true)
    setActionError(null)
    const result = await releaseGuestFromRoom(releasingAssignment, releaseReason.trim())
    if (result.ok) {
      setReleasingAssignment(null)
      setReleaseReason(null)
      setOpenRoomId(null)
      await load()
    } else {
      setActionError(result.error)
    }
    setLoading(false)
  }

  if (state.phase === 'loading') {
    return (
      <div className="flex flex-col gap-4" aria-busy>
        <div className="h-7 w-28 rounded-md bg-rule-strong" />
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-12 rounded-xl bg-surface" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: 16 }, (_, i) => (
            <div key={i} className="h-16 rounded-lg bg-surface" />
          ))}
        </div>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load rooms"
        description={state.message}
        action={<Button onClick={load}>Retry</Button>}
      />
    )
  }

  const { data } = state

  if (data.rooms.length === 0) {
    const isAdmin = access === 'admin'
    return (
      <EmptyState
        icon={<BuildingIcon className="h-7 w-7" />}
        title="No rooms set up"
        description={
          isAdmin
            ? 'Create a hotel first, then import rooms from an Excel sheet or add them manually.'
            : 'No hotels or rooms have been added yet. An admin needs to set them up first — ask them to add hotels and rooms.'
        }
        action={
          <div className="flex flex-col gap-2 w-full max-w-xs">
            {/* Admin-only, and it was not gated. /admin/** is behind a layout
                that redirects any non-admin to `/`, so an event_team user who
                tapped this was thrown out of the section — while the text
                beside it was already telling them to ask an admin. */}
            {isAdmin ? (
              <LinkButton
                href={`/admin/events/${eventCode}/hotels/new`}
                variant="primary"
                leadingIcon={<PlusIcon className="h-5 w-5" />}
                size="md"
                fullWidth
              >
                Add hotel
              </LinkButton>
            ) : null}
            <LinkButton
              href={`/${eventCode}/hospitality/rooms/new`}
              variant={isAdmin ? 'secondary' : 'primary'}
              leadingIcon={<PlusIcon className="h-5 w-5" />}
              size="md"
              fullWidth
            >
              Add rooms
            </LinkButton>
            {isAdmin ? (
              <LinkButton
                href={`/admin/events/${eventCode}/import-hotels`}
                variant="secondary"
                leadingIcon={<UploadIcon className="h-5 w-5" />}
                size="md"
                fullWidth
              >
                Import from Excel
              </LinkButton>
            ) : null}
          </div>
        }
      />
    )
  }

  const placedCount = rooms.reduce((n, r) => n + r.occupants.length, 0)
  const bedCount = rooms.reduce((n, r) => n + (r.isBlocked ? 0 : r.capacity), 0)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <PageTitle right={`${placedCount} / ${bedCount}`}>Rooms</PageTitle>
        {/* Once rooms exist the empty state is gone, so without this there is
            no route to room creation from anywhere in the staff tree. */}
        <LinkButton
          href={`/${eventCode}/hospitality/rooms/new`}
          variant="secondary"
          size="md"
          leadingIcon={<PlusIcon className="h-5 w-5" />}
        >
          Add rooms
        </LinkButton>
      </div>

      {/* Under-bedded families. Placed but below headcount — the suggest and
          allocate paths skip them once they hold a room, so their missing
          beds would never surface otherwise. */}
      {data.underBedded.length > 0 ? (
        <section className="flex flex-col gap-2 rounded-xl border border-warning/50 bg-tint-warning px-3.5 py-3">
          <p className="text-sm font-semibold text-warning">
            {data.underBedded.length} famil{data.underBedded.length === 1 ? 'y' : 'ies'} under-bedded
          </p>
          <ul className="flex flex-col gap-1">
            {data.underBedded.map((f) => (
              <li key={f.groupId}>
                <button
                  type="button"
                  disabled={loading || !f.needsTopUp}
                  onClick={() => attemptTopUp(f.groupId)}
                  className={cn(
                    'flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-ink',
                    f.needsTopUp ? 'hover:bg-warning/10 active:bg-warning/20' : 'cursor-default',
                  )}
                >
                  <span className="min-w-0 truncate font-medium">{f.headName}</span>
                  <span className="shrink-0 text-muted">
                    {f.placed} of {f.headcount} placed · {f.shortfall} bed{f.shortfall === 1 ? '' : 's'} short
                    {f.needsTopUp ? ' · tap to add members' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Placing banner. The screen is modal while a guest is in hand, and
          it says so in a bar you cannot scroll past — a two-tap move where
          the first tap is invisible is a move people make by accident. */}
      {placing ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/40 bg-brand-tint px-3.5 py-3">
          <p className="min-w-0 text-sm leading-snug text-ink">
            {selectedGuest ? (
              <>
                Moving <span className="font-medium">{selectedGuest.guestName}</span> — tap a
                room
              </>
            ) : (
              'Tap a room to place this guest'
            )}
          </p>
          <button
            type="button"
            onClick={clearSelection}
            className="tap shrink-0 font-mono text-xs tracking-eyebrow text-brand uppercase"
          >
            Cancel
          </button>
        </div>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red"
        >
          {actionError}
        </p>
      ) : null}

      {/* Unplaced guests. Above the grid because they are the reason you
          came: a guest with no bed is the open item, not the rooms. Members
          of a family are nested under the head, so a 6-pax family shows as
          one bold head with its unplaced members beneath it. */}
      {data.unplaced.length > 0 ? (
        <section className="flex flex-col gap-2.5">
          <SectionHead
            eyebrow="Not yet in a room"
            right={`${data.unplaced.length}`}
            inline
          />
          <div className="flex flex-col gap-1.5">
            {groupUnplacedByFamily(data.unplaced).map((family) => {
              const head = family.head
              return (
                <div key={family.groupId} className="flex flex-col gap-1.5">
                  {/* Head — bold, the family anchor. */}
                  {head ? (
                    <button
                      key={head.guestId}
                      type="button"
                      onClick={() => {
                        setSelectedUnplaced(selectedUnplaced === head.guestId ? null : head.guestId)
                        setSelectedGuest(null)
                        setActionError(null)
                      }}
                      aria-pressed={selectedUnplaced === head.guestId}
                      className={cn(
                        'tap min-h-12 rounded-xl border px-4 text-left text-sm font-semibold transition-colors duration-press ease-ledger',
                        selectedUnplaced === head.guestId
                          ? 'border-brand bg-brand-tint text-brand'
                          : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
                      )}
                    >
                      {head.guestName}
                    </button>
                  ) : null}
                  {/* Members — nested beneath the head, normal weight. */}
                  {family.members.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pl-4">
                      {family.members.map((u) => {
                        const on = selectedUnplaced === u.guestId
                        return (
                          <button
                            key={u.guestId}
                            type="button"
                            onClick={() => {
                              setSelectedUnplaced(on ? null : u.guestId)
                              setSelectedGuest(null)
                              setActionError(null)
                            }}
                            aria-pressed={on}
                            className={cn(
                              'tap min-h-11 rounded-full border px-3.5 text-left text-sm transition-colors duration-press ease-ledger',
                              on
                                ? 'border-brand bg-brand-tint text-brand'
                                : 'border-rule-strong bg-surface text-ink active:bg-surface-2',
                            )}
                          >
                            <span className="font-medium">{u.guestName}</span>
                            <span className="ml-2 text-muted">{u.headName}</span>
                          </button>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* Hotel tabs */}
      {hotels.length > 1 ? (
        <div className="flex gap-2" role="tablist" aria-label="Hotels">
          {hotels.map((h, i) => {
            const on = h.hotelId === activeHotel?.hotelId
            return (
              <button
                key={h.hotelId}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setHotelIdx(i)}
                className={cn(
                  'tap flex min-h-12 flex-1 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-1.5 transition-colors duration-press ease-ledger',
                  on
                    ? 'border-brand/50 bg-brand-tint'
                    : 'border-rule bg-surface active:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'text-center text-xs leading-tight font-medium',
                    on ? 'text-brand' : 'text-ink',
                  )}
                >
                  {h.hotelName}
                </span>
                <span className="figure text-[0.625rem] text-muted">{h.count} rooms</span>
              </button>
            )
          })}
        </div>
      ) : null}

      {/* Legend. Five states is past what anyone holds in their head, and
          this grid is the only screen where the fill IS the information. */}
      <ul className="flex flex-wrap gap-x-4 gap-y-2">
        {(['empty', 'partly_full', 'full', 'blocked', 'over_capacity'] as TileState[]).map(
          (s) => (
            <li key={s} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cn('h-2.5 w-2.5 rounded-xs', TILE_SKINS[s])}
                style={s === 'blocked' ? { backgroundImage: BLOCKED_HATCH } : undefined}
              />
              <span className="text-xs text-muted">{TILE_LABELS[s]}</span>
            </li>
          ),
        )}
      </ul>

      {/* The grid */}
      <ul className="grid grid-cols-4 gap-2" aria-label={`${activeHotel?.hotelName} rooms`}>
        {hotelRooms.map((room, i) => {
          const s = tileState(room)
          return (
            <li key={room.roomId}>
              <button
                type="button"
                onClick={() => handleTapRoom(room)}
                disabled={loading}
                style={{
                  animationDelay: `${Math.min(i, 16) * 18}ms`,
                  backgroundImage: s === 'blocked' ? BLOCKED_HATCH : undefined,
                }}
                className={cn(
                  'list-fade tap relative flex min-h-16 w-full flex-col items-center justify-center gap-1.5 rounded-lg',
                  'transition-transform duration-press ease-ledger active:scale-95',
                  TILE_SKINS[s],
                )}
              >
                {/* §5.4: hamper dot — green = delivered, red = pending,
                    brand = mixed (multi-room family, ask the team). */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-1 right-1 h-2 w-2 rounded-full',
                    HAMPER_DOT[hamperState(room)],
                  )}
                />
                <span className="figure text-base leading-none font-medium">
                  {room.roomNumber}
                </span>
                <span
                  aria-hidden
                  className={cn('text-[0.5rem] leading-none tracking-[2px]', DOT_TONES[s])}
                >
                  {occupancyDots(room)}
                </span>
                <span className="sr-only">
                  {TILE_LABELS[s]}, {room.occupants.length} of {room.capacity} beds,{' '}
                  {HAMPER_LABEL[hamperState(room)]}
                </span>
              </button>
            </li>
          )
        })}
      </ul>

      <p className="text-center text-xs leading-relaxed text-muted">
        Capacity is enforced by the database, not this screen. Going over needs a written
        reason, and the reason is kept.
      </p>

      {/* Room detail */}
      <BottomSheet
        open={Boolean(openRoom) && !overrideRoom && !releasingAssignment}
        onClose={() => setOpenRoomId(null)}
        label={openRoom ? `Room ${openRoom.roomNumber}` : 'Room'}
      >
        {openRoom ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="figure text-3xl leading-none font-medium text-ink">
                {openRoom.roomNumber}
              </span>
              <StatusPill
                tone={
                  tileState(openRoom) === 'blocked'
                    ? 'neutral'
                    : ROOM_STATUS_TONES[tileState(openRoom) as RoomStatus]
                }
                size="md"
              >
                {TILE_LABELS[tileState(openRoom)]}
              </StatusPill>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              {openRoom.hotelName} · capacity {openRoom.capacity}
            </p>

            <div className="mt-4 border-t border-rule pt-4">
              <SectionHead eyebrow="Assigned" right={`${openRoom.occupants.length}`} inline />

              {openRoom.occupants.length === 0 ? (
                <p className="mt-3 text-base text-muted">No active assignment.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {openRoom.occupants.map((occ) => (
                    <li
                      key={occ.assignmentId}
                      className="flex items-center gap-2 rounded-lg bg-surface-2 p-1.5"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGuest(occ)
                          setSelectedUnplaced(null)
                          setOpenRoomId(null)
                        }}
                        className="tap min-h-11 flex-1 rounded-md px-2.5 text-left text-base transition-colors duration-press ease-ledger active:bg-surface"
                      >
                        <span className="font-medium text-ink">{occ.guestName}</span>
                        {occ.isHead ? <Badge className="ml-2">Head</Badge> : null}
                        <span className="mt-0.5 block text-sm text-muted">{occ.headName}</span>
                        {/* §5.3: mobile + hamper status on the room-tap panel. */}
                        {occ.primaryMobile ? (
                          <a
                            href={`tel:${occ.primaryMobile}`}
                            className="tap mt-0.5 inline-block font-mono text-sm text-brand active:opacity-70"
                          >
                            {occ.primaryMobile}
                          </a>
                        ) : null}
                        <span
                          className={
                            occ.hamperDelivered
                              ? 'mt-0.5 block text-sm text-ledger-green'
                              : 'mt-0.5 block text-sm text-ledger-red'
                          }
                        >
                          {occ.hamperDelivered ? 'Hamper delivered' : 'Hamper not delivered'}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setReleasingAssignment(occ.assignmentId)
                          setReleaseReason('')
                        }}
                        className="tap min-h-11 shrink-0 rounded-md px-3 font-mono text-xs tracking-eyebrow text-muted uppercase active:text-ledger-red"
                      >
                        Release
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <Button
              variant="secondary"
              size="lg"
              fullWidth
              className="mt-5"
              onClick={() => setOpenRoomId(null)}
            >
              Close
            </Button>
          </>
        ) : null}
      </BottomSheet>

      {/* Capacity override */}
      <BottomSheet
        open={Boolean(overrideRoom)}
        onClose={() => {
          setOverrideRoom(null)
          setOverrideReason('')
        }}
        label="Room is full"
      >
        <h2 className="text-lg font-medium text-ledger-red">
          Room {overrideRoom?.roomNumber} is full. Add anyway?
        </h2>
        <p className="mt-1.5 text-sm leading-snug text-muted">
          Overfilling needs a reason, and the reason is kept on the assignment as the audit
          trail. Write what you would tell the manager.
        </p>
        <Textarea
          label="Reason"
          value={overrideReason}
          onChange={(e) => setOverrideReason(e.target.value)}
          placeholder="Family insisted on staying together"
          rows={2}
          containerClassName="mt-4"
        />
        <div className="mt-4 flex flex-col gap-2">
          <Button
            size="lg"
            fullWidth
            onClick={handleOverride}
            disabled={!overrideReason.trim() || loading}
            loading={loading}
          >
            Add anyway
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={() => {
              setOverrideRoom(null)
              setOverrideReason('')
            }}
          >
            Cancel
          </Button>
        </div>
      </BottomSheet>

      {/* Release */}
      <BottomSheet
        open={Boolean(releasingAssignment)}
        onClose={() => {
          setReleasingAssignment(null)
          setReleaseReason(null)
        }}
        label="Release from room"
      >
        <h2 className="text-lg font-medium text-ink">Release from room</h2>
        <p className="mt-1.5 text-sm leading-snug text-muted">
          The assignment row is kept — only <code className="font-mono">released_at</code> is
          set. Give a reason for the record.
        </p>
        <Textarea
          label="Reason"
          value={releaseReason ?? ''}
          onChange={(e) => setReleaseReason(e.target.value)}
          placeholder="Moved to Chandra Vilas at the family's request"
          rows={2}
          containerClassName="mt-4"
        />
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="danger"
            size="lg"
            fullWidth
            onClick={handleReleaseConfirm}
            disabled={!releaseReason?.trim() || loading}
            loading={loading}
          >
            Release
          </Button>
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onClick={() => {
              setReleasingAssignment(null)
              setReleaseReason(null)
            }}
          >
            Cancel
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}
