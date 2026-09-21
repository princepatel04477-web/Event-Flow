'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'

import { CameraIcon, ChevronDownIcon, GiftIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { ListRow } from '@/components/ui/ListRow'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { PageTitle } from '@/components/ui/PageTitle'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  generateDeliverables,
  readDeliveryRun,
  type DeliveryRunRow,
} from '@/lib/actions/deliveries'
import { queryKeys } from '@/lib/query/keys'

import { AppHint } from '../../_components/AppHint'

const KIND_LABEL: Record<string, string> = {
  hamper: 'Hamper',
  return_gift: 'Return gift',
}

export interface HamperRunProps {
  eventId: string
  eventCode: string
  /** Admin only — the one control that creates `deliverables` rows. */
  canGenerate: boolean
}

/**
 * Job 3's screen: who is still owed a hamper, by name, one tap from the camera.
 *
 * THE PROOF FLOW IS NOT HERE AND IS NOT TOUCHED. A hamper is delivered because
 * a photo exists, not because somebody tapped a button (CLAUDE.md §5.2:
 * `delivery_proofs` is insert-only, and two triggers refuse update and delete
 * for everyone including an admin). This screen is the list; the row opens the
 * existing `DeliveryDetail`, imported unchanged from the v1 tree.
 *
 * WHERE THE v1 SCREEN WENT WRONG, and what changed: its two chip rows (hotel,
 * then kind) and its sealed-row styling sat ABOVE the work, and its heading was
 * "Delivery run" — a logistics term for an object nobody in the app is. Here the
 * list is only the families still owed something, in walking order, and the two
 * filter sets are behind one control.
 */
export function HamperRun({ eventId, eventCode, canGenerate }: HamperRunProps) {
  const [hotel, setHotel] = useState<string | null>(null)
  const [kind, setKind] = useState<string | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generated, setGenerated] = useState<string | null>(null)
  const [generateError, setGenerateError] = useState<string | null>(null)

  const {
    data,
    isPending,
    isFetching,
    error,
    refetch,
  } = useQuery({
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

  const visible = useMemo(() => {
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

  const filterLabel = [hotel ?? 'All hotels', kind ? KIND_LABEL[kind] : null]
    .filter(Boolean)
    .join(' · ')

  const loadError = error instanceof Error ? error.message : error ? String(error) : null
  const stale = isFetching && data !== undefined

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <PageTitle className="min-w-0 flex-1">Deliver a hamper</PageTitle>
        {/* ONE control. The v1 list had a hotel chip row AND a kind chip row,
            both above the first family name. */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="tap inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl border border-rule-strong bg-surface px-3 text-sm font-medium text-ink active:bg-surface-2"
        >
          {filterLabel}
          <ChevronDownIcon className="h-4 w-4 text-muted" aria-hidden />
        </button>
      </div>

      {stale ? (
        <p role="status" className="-mt-1 text-xs text-muted">
          Updating…
        </p>
      ) : null}

      {/* One line, once per device, above the work. Tap anywhere to clear it. */}
      <AppHint screen="hamper-run">Tap a person to open their hamper</AppHint>

      {loadError ? (
        <ErrorState
          title={loadError}
          description={data ? 'Showing the last list that loaded.' : undefined}
          onRetry={() => void refetch()}
        />
      ) : null}

      {isPending ? (
        <LoadingRows count={6} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<GiftIcon className="h-7 w-7" />}
          title="No hampers on this event yet"
          description={
            canGenerate
              ? 'Hampers and return gifts are created from the guest list — every family with a room gets a hamper, and every family marked for a return gift gets one. Nothing is written twice if you run it again.'
              : 'Hampers and return gifts are created from the guest list by your event admin. This screen fills in by itself once they have.'
          }
          action={
            canGenerate ? (
              // This reader is the one who can act, and the action already
              // exists further down the screen. The empty state runs THE SAME
              // handler rather than a second one, and that handler creates only
              // what is missing (hence "Create what is missing" below), so a
              // tap here cannot write a duplicate hamper. R3: an empty state
              // that only explains is a dead end.
              <Button variant="secondary" fullWidth onClick={() => void handleGenerate()}>
                {generating ? 'Creating…' : 'Create them now'}
              </Button>
            ) : (
              // A hamper runner cannot create them; the useful next step is the
              // screen that says whether the guest list they come from is real
              // yet, so the instruction to "ask your admin" has a destination.
              <Link
                href={`/${eventCode}/guests/list`}
                className="tap flex min-h-12 items-center justify-center rounded-xl border border-rule-strong bg-surface px-3 text-center text-base font-medium text-ink active:bg-surface-2"
              >
                Open the guest list
              </Link>
            )
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<GiftIcon className="h-7 w-7" />}
          title="Nothing left to deliver"
          description={
            hotel !== null || kind !== null
              ? 'Every hamper in this view has been delivered. Clear the filter to see the rest.'
              : 'Every hamper on this event has been delivered.'
          }
          action={
            hotel !== null || kind !== null ? (
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
        <ul className="flex flex-col gap-2.5" aria-label="Families waiting for a hamper">
          {visible.map((row) => (
            <li key={row.id}>
              <HamperRow row={row} eventCode={eventCode} />
            </li>
          ))}
        </ul>
      )}

      {canGenerate ? (
        <section className="flex flex-col gap-2.5 border-t border-rule pt-4">
          <h3 className="eyebrow">Event admin</h3>
          <p className="text-sm leading-snug text-muted">
            Adds a hamper for every family with a room, and a return gift for every family marked
            for one.
          </p>
          <Button variant="secondary" fullWidth onClick={() => void handleGenerate()}>
            {generating ? 'Creating…' : 'Create what is missing'}
          </Button>
          {generated ? (
            <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-ink">
              {generated}
            </p>
          ) : null}
          {generateError ? (
            <p
              role="alert"
              className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
            >
              {generateError}
            </p>
          ) : null}
        </section>
      ) : null}

      <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} label="Choose what to see">
        <div className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold text-ink">Choose what to see</h2>

          {hotels.length > 1 ? (
            <div className="flex flex-col gap-2">
              <h3 className="eyebrow">Which hotel</h3>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Which hotel">
                <Chip selected={hotel === null} onClick={() => setHotel(null)}>
                  All hotels
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
            <h3 className="eyebrow">What is being delivered</h3>
            <div className="flex flex-wrap gap-2" role="group" aria-label="What is being delivered">
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

          <Button size="lg" fullWidth onClick={() => setSheetOpen(false)}>
            Done
          </Button>
        </div>
      </BottomSheet>
    </div>
  )
}

/**
 * One family that is still owed something.
 *
 * The whole row is the link and the camera affordance sits under it, because
 * the job is "walk to the door and take the photo" — the row must be tappable
 * with a thumb while holding a hamper in the other hand.
 */
function HamperRow({ row, eventCode }: { row: DeliveryRunRow; eventCode: string }) {
  const place = [row.hotel_name, row.room_number ? `Room ${row.room_number}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      href={`/${eventCode}/hospitality/deliveries/${row.id}`}
      className="tap block rounded-xl border border-rule-strong bg-surface transition-colors duration-press ease-ledger active:bg-surface-2"
    >
      <ListRow
        identifier={displayName(row)}
        meta={`${place || 'No room yet'} · ${KIND_LABEL[row.kind] ?? row.kind}`}
        right={
          <StatusPill tone={row.room_number ? 'active' : 'attention'}>
            {row.room_number ? 'To deliver' : 'No room'}
          </StatusPill>
        }
      />
      <span className="flex min-h-12 items-center justify-center gap-2 border-t border-rule font-semibold text-brand">
        <CameraIcon className="h-4 w-4" aria-hidden />
        Take the photo
      </span>
    </Link>
  )
}

/** A person's name first, never an id. */
function displayName(row: DeliveryRunRow): string {
  const name = row.head_name?.trim()
  if (name) return name
  return row.primary_mobile?.trim() || 'Unnamed family'
}

export default HamperRun
