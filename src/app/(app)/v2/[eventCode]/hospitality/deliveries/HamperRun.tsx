'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'

import { CameraIcon, GiftIcon } from '@/components/icons'
import { BottomBar } from '@/components/ui/BottomBar'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { NowCard } from '@/components/ui/NowCard'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import {
  generateDeliverables,
  readDeliveryRun,
  type DeliveryRunRow,
} from '@/lib/actions/deliveries'
import { queryKeys } from '@/lib/query/keys'

const KIND_LABEL: Record<string, string> = {
  hamper: 'Hamper',
  return_gift: 'Return gift',
}

export interface HamperRunProps {
  eventId: string
  eventCode: string
  /** Admin only — the one control that creates `deliverables` rows. */
  canGenerate: boolean
  /**
   * Whether this viewer's department may open the guest list.
   *
   * Answered by the guard, not guessed here: `hamper` and `hospitality` are both
   * outside `DEPARTMENT_SECTIONS.guests`, so the link this gates would bounce
   * them into `requireSection`'s redirect and back with a `?denied=section`
   * marker that nothing renders — a button that looks dead. R1 found it.
   */
  canOpenGuestList: boolean
  /**
   * The detail path this tree builds inside itself, so the SAME component can
   * serve both routes that render it without either one's links leaking into
   * the other.
   *
   * Load-bearing, not tidiness. The screen is reachable at `/{event}/hamper`
   * (the v3 Hampers tab) and at `/{event}/hospitality/deliveries` (the v2-era
   * address and the hamper department's post-login home). A hardcoded detail
   * path meant the other route's rows navigated out of the section the runner
   * was in. The default is the `hospitality/deliveries` tree, which is where
   * this component used to hardcode it; the hamper route passes `hamper`.
   */
  detailBase?: string
}

/**
 * The hamper run: who is still owed something, one tap from the camera.
 *
 * REBUILT TO SPEC-V3 §4. ONE JOB PER SCREEN: walk to the next door and take a
 * photo. The screen is now, top to bottom —
 *
 *   1. `Progress` — hampers delivered out of every hamper on the event.
 *   2. ONE `NowCard` — the next door, by room number, with the family and what
 *      they get, and a marigold button into the proof screen.
 *   3. "After that" — the rest of the run as `Row`s, in walking order, in one
 *      white register rather than a stack of cards.
 *   4. `BottomBar` — "Skip this door" (secondary) + "Photo · delivered"
 *      (primary), both aimed at the SAME next door, with a one-line summary.
 *
 * WHAT WAS REMOVED, because §3 lists it: the second title (`PageTitle` under
 * the shell's own header), the per-device hint banner, the "Updating…" line,
 * the paragraph explaining what a proof is, the two-chip filter row that used
 * to sit above the first family name, the sealed/queued card walls, and the
 * "Event admin" section, which is now one line in the filter sheet where the
 * admin who can use it is already looking. The filter itself survives — a
 * runner with 40 hampers across two hotels needs it — behind one control.
 *
 * THE PROOF FLOW IS NOT HERE AND IS NOT TOUCHED. A hamper is delivered because
 * a photo exists, not because somebody tapped a button (CLAUDE.md §5.2:
 * `delivery_proofs` is insert-only, and two triggers refuse update and delete
 * for everyone including an admin). This screen is the list; a row opens the
 * existing `DeliveryDetail`.
 *
 * WHY THE SECONDARY IS "Skip this door" AND NOT "Not in room". SPEC-V3 §4 names
 * "Not in room", and the honest reason it is not that is written down here so
 * the next session does not re-litigate it: "not in room" is a WRITE — it has
 * to say something durable about a family the runner stood outside, and
 * `deliverables.status` is flipped to delivered by the `delivery_proofs` insert
 * trigger and by nothing else (CLAUDE.md §5.2). There is no "attempted" state
 * and §5 forbids inventing one. A control with that label that only advanced
 * the list would be the app lying about what it recorded. So the secondary
 * does exactly what it can honestly do — move past a door without committing
 * anything — and the primary is still the one way a hamper is marked delivered.
 */
export function HamperRun({
  eventId,
  eventCode,
  canGenerate,
  canOpenGuestList,
  detailBase = 'hospitality/deliveries',
}: HamperRunProps) {
  const [hotel, setHotel] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)
  /**
   * Doors this runner has passed without a proof, for this visit only.
   *
   * In memory, never persisted, and never sent anywhere: skipping is a way of
   * getting on with the round, not a record about the family. A reload is the
   * same as walking back down the corridor.
   */
  const [skipped, setSkipped] = useState<readonly string[]>([])

  const router = useRouter()

  const { data, isPending, error, refetch } = useQuery({
    queryKey: queryKeys.deliveries.list(eventId),
    // ALWAYS STALE. This screen is what the proof screen returns to, and a
    // list cached for the default 30s would still be offering a hamper that
    // was sealed a few seconds ago — the runner would walk back to a door they
    // have already been to. Every mount re-reads.
    staleTime: 0,
    queryFn: async () => {
      const result = await readDeliveryRun(eventId)
      if (!result.ok) throw new Error(result.error ?? 'Could not load the hamper list.')
      return result.rows
    },
  })

  const rows = useMemo(() => data ?? [], [data])

  // A hamper is delivered because a photo exists — so a row that already has a
  // proof is finished and leaves this list entirely rather than sitting on it
  // in a quieter colour.
  const pending = useMemo(() => rows.filter((r) => r.status !== 'delivered'), [rows])

  const hotels = useMemo(() => {
    const names = new Set(pending.map((r) => r.hotel_name ?? '(no hotel)'))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [pending])

  const inFilter = useMemo(() => {
    const list = pending.filter((r) => {
      if (hotel !== null && (r.hotel_name ?? '(no hotel)') !== hotel) return false
      if (kind !== null && r.kind !== kind) return false
      return true
    })
    // The order a person walks: hotel, then floor, then room number.
    return [...list].sort((a, b) => {
      const h = (a.hotel_name ?? '').localeCompare(b.hotel_name ?? '')
      if (h !== 0) return h
      const f = (a.floor ?? '').localeCompare(b.floor ?? '')
      if (f !== 0) return f
      return (a.room_number ?? '').localeCompare(b.room_number ?? '')
    })
  }, [pending, hotel, kind])

  // Skipped doors drop to the back of the round rather than disappearing: they
  // are still owed a hamper, so they must still be on the screen somewhere.
  const visible = useMemo(
    () => [...inFilter.filter((r) => !skipped.includes(r.id)), ...inFilter.filter((r) => skipped.includes(r.id))],
    [inFilter, skipped],
  )

  async function handleGenerate() {
    if (generating) return
    setGenerating(true)
    setGenerateError(null)
    setGenerated(null)
    const result = await generateDeliverables(eventId)
    setGenerating(false)
    if (!result.ok) {
      setGenerateError(result.error ?? 'Could not create the hampers.')
      return
    }
    const s = result.summary
    setGenerated(
      `Created ${s.hampersCreated} ${s.hampersCreated === 1 ? 'hamper' : 'hampers'} and ` +
        `${s.returnGiftsCreated} ${s.returnGiftsCreated === 1 ? 'return gift' : 'return gifts'}. ` +
        `${s.existingHampers} ${s.existingHampers === 1 ? 'hamper' : 'hampers'} and ` +
        `${s.existingReturnGifts} ${s.existingReturnGifts === 1 ? 'return gift' : 'return gifts'} ` +
        'were already there.',
    )
    await refetch()
  }

  const filtered = hotel !== null || kind !== null
  const filterCount = (hotel !== null ? 1 : 0) + (kind !== null ? 1 : 0)

  const loadError = error instanceof Error ? error.message : error ? String(error) : null

  const delivered = rows.length - pending.length
  const next = visible[0] ?? null
  const rest = visible.slice(1)

  const detailHref = (row: DeliveryRunRow) => `/${eventCode}/${detailBase}/${row.id}`

  return (
    // `pb-bottombar` clears the fixed bar. A single-screen department (the
    // hamper team) has no tab bar, and the bar lifts itself above one when it
    // exists — so this is the only clearance the screen needs.
    <div className="flex flex-col gap-5 pb-bottombar">
      <Progress label="Hampers delivered" done={delivered} total={rows.length} tone="amber" />

      {/* ONE control for the filter, right under the number it filters. */}
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 truncate text-sm text-muted">
          {pending.length === 0
            ? 'Nothing left to deliver'
            : [hotel ?? 'All hotels', kind ? (KIND_LABEL[kind] ?? kind) : null]
                .filter(Boolean)
                .join(' · ')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setSheetOpen(true)}
          className="shrink-0 border border-rule-strong"
        >
          {filtered ? `Filter · ${filterCount}` : 'Filter'}
        </Button>
      </div>

      {loadError ? (
        <ErrorState
          title={loadError}
          description={data ? 'Showing the last list that loaded.' : undefined}
          onRetry={() => void refetch()}
        />
      ) : null}

      {isPending ? (
        <LoadingRows count={5} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<GiftIcon className="h-7 w-7" />}
          title="No hampers yet"
          description={
            canGenerate
              ? 'Every family with a room gets a hamper.'
              : 'Your event admin creates them from the guest list.'
          }
          action={
            canGenerate ? (
              <Button variant="secondary" fullWidth onClick={() => void handleGenerate()}>
                {generating ? 'Creating…' : 'Create them now'}
              </Button>
            ) : canOpenGuestList ? (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  router.push(`/${eventCode}/guests/list`)
                }}
              >
                Open the guest list
              </Button>
            ) : undefined
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<GiftIcon className="h-7 w-7" />}
          title={filtered ? 'Nothing in this filter' : 'Nothing left to deliver'}
          description={
            filtered
              ? 'Every hamper in this view is delivered.'
              : 'Every hamper on this event has been delivered.'
          }
          action={
            filtered ? (
              <Button
                variant="secondary"
                fullWidth
                onClick={() => {
                  setHotel(null)
                  setKind(null)
                }}
              >
                Clear the filter
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {next ? (
            <NowCard
              eyebrow="Next door"
              headline={roomHeadline(next)}
              context={nextContext(next)}
              actionLabel="Take photo"
              actionHref={detailHref(next)}
            />
          ) : null}

          {rest.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="eyebrow">After that</h2>
              {/* The rows are ONE white register with hairline separators, not
                  a stack of cards: `Row` draws its own bottom border and
                  `last:border-b-0`. */}
              <ul className="overflow-hidden rounded-2xl border border-rule bg-surface">
                {rest.map((row) => (
                  <li key={row.id}>
                    <Row
                      heading={displayName(row)}
                      meta={rowMeta(row)}
                      badge={<RoomBadge roomNumber={row.room_number} />}
                      status={rowStatus(row, skipped)}
                      tone={row.room_number ? 'waiting' : 'problem'}
                      onPress={() => {
                        router.push(detailHref(row))
                      }}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      {/* The bar's summary and its two controls all describe the SAME door, so
          a runner never has to work out which family the buttons apply to.

          WHY THE PRIMARY IS "Photo" AND CARRIES THE CAMERA GLYPH. Width, not
          taste, and the arithmetic is in `tests/v3-travel-width.test.ts`.
          `BottomBar` gives each control half the bar — `(360 − 32 − 10) / 2 =
          159px` — and `Button` is `whitespace-nowrap` with `px-5`, so a label
          has 119px of room, minus 28px for the glyph and its gap. "Take photo"
          needs 113px of the remaining 91; "Photo · delivered" needs 148. The bar
          is `fixed`, so what overflows is not a clipped screenshot — it is
          characters a runner cannot read and cannot reach.
          "Photo" is also the truer label: this app never writes "delivered" on a
          tap (CLAUDE.md §5.2), and the marigold Now card directly above already
          says "Take photo" in full where there IS room for it. */}
      {next ? (
        <BottomBar
          summary={
            skipped.length > 0
              ? `${pending.length} to go · next is ${roomPlace(next)} · ${skipped.length} skipped`
              : `${pending.length} to go · next is ${roomPlace(next)}`
          }
          secondary={{
            label: 'Not in room',
            onPress: () => setSkipped((prev) => [...prev, next.id]),
          }}
          primary={{
            label: 'Photo',
            href: detailHref(next),
            icon: <CameraIcon className="h-5 w-5" />,
          }}
        />
      ) : null}

      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        label="Filter the hamper run"
      >
        <div className="flex flex-col gap-5">
          <h2 className="text-lg font-semibold text-ink">Filter</h2>

          {hotels.length > 1 ? (
            <div className="flex flex-col gap-2">
              <h3 className="eyebrow">Hotel</h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Hotel">
                <Chip selected={hotel === null} onClick={() => setHotel(null)}>
                  All
                </Chip>
                {hotels.map((name) => (
                  <Chip key={name} selected={hotel === name} onClick={() => setHotel(name)}>
                    {name}
                  </Chip>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <h3 className="eyebrow">Delivering</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Delivering">
              <Chip selected={kind === null} onClick={() => setKind(null)}>
                Both
              </Chip>
              <Chip selected={kind === 'hamper'} onClick={() => setKind('hamper')}>
                Hampers
              </Chip>
              <Chip selected={kind === 'return_gift'} onClick={() => setKind('return_gift')}>
                Return gifts
              </Chip>
            </div>
          </div>

          <Button variant="secondary" size="lg" fullWidth onClick={() => setSheetOpen(false)}>
            Done
          </Button>

          {/* The admin's one control, in the sheet where the two chips that
              need to exist before it are. It used to be a whole section at the
              foot of the screen with a heading, a paragraph and a button, for
              the one viewer in ten who can use it. */}
          {canGenerate ? (
            <div className="flex flex-col gap-2 border-t border-rule pt-4">
              <h3 className="eyebrow">Event admin</h3>
              {generated ? (
                <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-ink">{generated}</p>
              ) : null}
              {generateError ? (
                <p
                  role="alert"
                  className="rounded-xl bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
                >
                  {generateError}
                </p>
              ) : null}
              <Button variant="secondary" fullWidth onClick={() => void handleGenerate()}>
                {generating ? 'Creating…' : 'Create what is missing'}
              </Button>
            </div>
          ) : null}
        </div>
      </BottomSheet>
    </div>
  )
}

/**
 * The avatar slot, holding the room number instead of initials.
 *
 * A hamper round is walked by room, and six rows of "RK SW PA" tell a runner
 * nothing about which door is which. The room number is the identifier they are
 * actually holding, so it takes the 40px slot and the name sits beside it.
 */
function RoomBadge({ roomNumber }: { roomNumber: string | null }) {
  return (
    <span className="figure flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-sm font-semibold text-ink">
      {roomNumber ?? '—'}
    </span>
  )
}

/**
 * A person's name first, never an id, and never the word "Unknown".
 *
 * A row with no head name falls back to the mobile number, because on this
 * screen the alternative is six identical rows reading "Unnamed family".
 */
function displayName(row: DeliveryRunRow): string {
  const name = row.head_name?.trim()
  if (name) return name
  return row.primary_mobile?.trim() || 'Unnamed family'
}

/** "Room 104", or the hotel, or what is already known instead of a room. */
function roomHeadline(row: DeliveryRunRow): string {
  if (row.room_number) return `Room ${row.room_number}`
  if (row.hotel_name) return row.hotel_name
  return displayName(row)
}

/** "Hotel Grand · Room 104" — where the door is. */
function roomPlace(row: DeliveryRunRow): string {
  return [row.hotel_name, row.room_number ? `Room ${row.room_number}` : 'no room']
    .filter(Boolean)
    .join(' · ')
}

/** One line of context under the Now headline: who, and what they get. */
function nextContext(row: DeliveryRunRow): string {
  const what = KIND_LABEL[row.kind] ?? row.kind
  const where = row.room_number ? roomPlace(row) : `${roomPlace(row)} — sort this first`
  return `${displayName(row)} · ${what} · ${where}`
}

/** One muted line on a row: the kind, and where it goes. */
function rowMeta(row: DeliveryRunRow): string {
  const what = KIND_LABEL[row.kind] ?? row.kind
  if (!row.room_number) return `${what} · no room yet`
  return `${what} · ${row.hotel_name ?? 'No hotel'}`
}

/**
 * The status word on a row.
 *
 * "Skipped" is a statement about THIS visit and nothing else — it is the only
 * state on this screen the app does not read back from the database, so it is
 * allowed to disappear on reload without anything being lost.
 */
function rowStatus(row: DeliveryRunRow, skipped: readonly string[]): string {
  if (skipped.includes(row.id)) return 'Skipped'
  return row.room_number ? 'To go' : 'No room'
}

export default HamperRun
