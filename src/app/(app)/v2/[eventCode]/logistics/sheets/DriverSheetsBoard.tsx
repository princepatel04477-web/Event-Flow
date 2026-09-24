'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import * as XLSX from 'xlsx'

import { FileTextIcon, PhoneIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { LinkButton } from '@/components/ui/LinkButton'
import { LoadingRows } from '@/components/ui/LoadingRows'
import { Row } from '@/components/ui/Row'
import { readDriverSheets, type DriverSheetTrip } from '@/lib/actions/departures'
import { copyText } from '@/lib/ui/copyText'

export interface DriverSheetsBoardProps {
  eventId: string
  eventCode: string
}

/**
 * Driver sheets: one sheet per committed trip, ready to send to a driver.
 *
 * RESTYLED, NOT REDESIGNED (SPEC-V3 §4). The read, the WhatsApp text and the
 * workbook are all byte-for-byte the same work the v1 screen did —
 * `readDriverSheets`, the same `formatWhatsApp` line order, the same
 * `json_to_sheet` columns. What changed is the shape:
 *
 *   - Each trip is ONE `Row` (vehicle, driver · families) instead of an
 *     accordion card that hid the families behind a tap and then showed them
 *     only after the card had already been opened once.
 *   - The detail, the copy button and the per-sheet export live in a sheet, per
 *     SPEC-V3 §2 — no page navigation mid-task.
 *   - The header row lost its second title (the shell renders one) and kept the
 *     one control that is genuinely screen-wide: export everything.
 *
 * NOTHING WRITES HERE. A driver sheet is a read of a committed plan; the screens
 * that create trips are the trip planner and the departures board.
 */
export function DriverSheetsBoard({ eventId, eventCode }: DriverSheetsBoardProps) {
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  /**
   * The read, through TanStack Query rather than a `useEffect` + `useState`
   * pair.
   *
   * WHY THIS CHANGED. The v1 screen fetched from an effect that called a
   * `useCallback` which did `setTrips(await …)`. The comment it carried was
   * right about the bug it was avoiding (`useState(() => load())` runs during
   * render, so it also ran on the server and desynced hydration) and wrong
   * about the fix: the repo's own lint rule now rejects setState in an effect
   * outright, and the query cache is where every other screen in this tree
   * keeps a server read. `isPending` also replaces the hand-rolled `null` state,
   * so there is no longer a way to render "no trips" while the first read is in
   * flight — which the v1 version did, flashing its empty state on every visit.
   *
   * The key is built here rather than added to `queryKeys`: `sheets` has no
   * second caller to share a cache entry with, so a factory entry would be a key
   * nothing else reads. It is still `['event', eventId, …]`-shaped, which is the
   * tenancy rule every key in this app obeys.
   */
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ['event', eventId, 'logistics', 'driver-sheets'],
    queryFn: () => readDriverSheets(eventId),
    // A committed plan is written by another screen; re-read on every mount so a
    // sheet opened straight after committing a plan is not the previous plan.
    staleTime: 0,
  })

  const trips = data ?? null
  const openTrip = openTripId ? (trips ?? []).find((t) => t.tripId === openTripId) ?? null : null

  async function handleCopy(trip: DriverSheetTrip) {
    // `writeText` rejects on an http origin or an unfocused WebView. The label
    // only flips once the write has actually landed, and a failure says so out
    // loud — otherwise the runner pastes an empty clipboard into WhatsApp (m6).
    setCopyError(null)
    setCopied(null)
    const result = await copyText(formatWhatsApp(trip))
    if (result.ok) setCopied(trip.tripId)
    else setCopyError(result.message)
  }

  function handleExport(tripsToWrite: readonly DriverSheetTrip[]) {
    const rows = tripsToWrite.flatMap((t) =>
      t.families.map((f) => ({
        Vehicle: t.vehicleLabel ?? 'Unnamed',
        Driver: t.driverName ?? '',
        'Driver mobile': t.driverMobile ?? '',
        'Scheduled at': t.scheduledTime ? new Date(t.scheduledTime).toLocaleString() : '',
        Pickup: t.pickupPoint ?? '',
        Drop: t.dropPoint ?? '',
        Direction: t.direction,
        Family: f.headName,
        PAX: f.pax,
        Contact: f.contactNumber ?? '',
      })),
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Driver Sheets')
    XLSX.writeFile(wb, 'driver_sheets.xlsx')
  }

  if (error) {
    return (
      <ErrorState
        title={error instanceof Error ? error.message : 'Could not load the driver sheets.'}
        onRetry={() => void refetch()}
      />
    )
  }

  if (isPending || trips === null) return <LoadingRows count={4} />

  if (trips.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon className="h-7 w-7" />}
        title="No planned trips"
        description="Sheets are written when a plan is committed in the trip planner."
        action={
          <LinkButton href={`/${eventCode}/logistics/trips`} variant="secondary" fullWidth>
            Open the trip planner
          </LinkButton>
        }
      />
    )
  }

  const seatTotal = trips.reduce((n, t) => n + t.families.reduce((m, f) => m + f.pax, 0), 0)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-sm text-muted">
          {trips.length} {trips.length === 1 ? 'trip' : 'trips'} · {seatTotal}{' '}
          {seatTotal === 1 ? 'seat' : 'seats'}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 border border-rule-strong"
          onClick={() => handleExport(trips)}
        >
          Export all
        </Button>
      </div>

      <ul className="overflow-hidden rounded-2xl border border-rule bg-surface">
        {trips.map((trip) => (
          <li key={trip.tripId}>
            <Row
              heading={trip.vehicleLabel ?? 'Unnamed vehicle'}
              meta={tripMeta(trip)}
              badge={<DirectionBadge direction={trip.direction} />}
              status={`${trip.families.length} ${trip.families.length === 1 ? 'family' : 'families'}`}
              tone="neutral"
              onPress={() => {
                setCopied(null)
                setCopyError(null)
                setOpenTripId(trip.tripId)
              }}
            />
          </li>
        ))}
      </ul>

      <LinkButton href={`/${eventCode}/logistics/trips`} variant="secondary" fullWidth>
        Open the trip planner
      </LinkButton>

      <BottomSheet
        open={openTrip !== null}
        onClose={() => setOpenTripId(null)}
        label={openTrip ? (openTrip.vehicleLabel ?? 'Trip sheet') : 'Trip sheet'}
      >
        {openTrip ? (
          <div className="flex flex-col gap-5">
            <div className="min-w-0">
              <h2 className="font-display text-2xl leading-tight font-semibold text-ink">
                {openTrip.vehicleLabel ?? 'Unnamed vehicle'}
              </h2>
              <p className="mt-1 text-sm text-muted">{tripMeta(openTrip)}</p>
            </div>

            <dl className="flex flex-col">
              <SheetRow
                label="Driver"
                value={openTrip.driverName ?? 'Not assigned'}
              />
              {openTrip.scheduledTime ? (
                <SheetRow
                  label="Time"
                  value={new Date(openTrip.scheduledTime).toLocaleString()}
                />
              ) : null}
              {openTrip.pickupPoint ? <SheetRow label="Pickup" value={openTrip.pickupPoint} /> : null}
              {openTrip.dropPoint ? <SheetRow label="Drop" value={openTrip.dropPoint} /> : null}
            </dl>

            {openTrip.driverMobile ? (
              <a
                href={`tel:${openTrip.driverMobile}`}
                className="tap flex min-h-12 items-center gap-2 font-mono text-base font-medium text-brand active:opacity-70"
              >
                <PhoneIcon className="h-5 w-5" aria-hidden />
                {openTrip.driverMobile}
              </a>
            ) : null}

            <section className="flex flex-col gap-2">
              <h3 className="eyebrow">On this sheet</h3>
              <ul className="overflow-hidden rounded-2xl border border-rule bg-surface-2">
                {openTrip.families.map((family, i) => (
                  <li key={`${openTrip.tripId}-${i}`}>
                    <Row
                      heading={family.headName}
                      meta={family.contactNumber ?? undefined}
                      status={`${family.pax} ${family.pax === 1 ? 'guest' : 'guests'}`}
                      tone="neutral"
                    />
                  </li>
                ))}
              </ul>
            </section>

            <Button variant="secondary" size="lg" fullWidth onClick={() => void handleCopy(openTrip)}>
              {copied === openTrip.tripId ? 'Copied' : 'Copy for WhatsApp'}
            </Button>

            {copyError ? (
              <p role="alert" className="text-sm font-medium text-ledger-red">
                {copyError}
              </p>
            ) : null}

            <Button
              variant="ghost"
              fullWidth
              onClick={() => handleExport([openTrip])}
            >
              Export this sheet
            </Button>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )
}

function SheetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule py-2.5 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium text-ink">{value}</dd>
    </div>
  )
}

/** The avatar slot: which way the vehicle is going, as a single letter. */
function DirectionBadge({ direction }: { direction: string }) {
  const letter = direction === 'departure' ? 'OUT' : direction === 'arrival' ? 'IN' : direction.slice(0, 3).toUpperCase()
  return (
    <span className="figure flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold text-ink">
      {letter}
    </span>
  )
}

function tripMeta(trip: DriverSheetTrip): string {
  const when = trip.scheduledTime ? new Date(trip.scheduledTime).toLocaleString() : null
  const parts = [trip.driverName ?? 'No driver', when, trip.pickupPoint].filter(
    (p): p is string => Boolean(p),
  )
  return parts.join(' · ')
}

/**
 * The WhatsApp text, verbatim from the v1 screen.
 *
 * Kept byte-for-byte rather than "improved": drivers have been receiving this
 * shape, and a reformatted message on departure day is a message they have to
 * re-read. The `filter(Boolean)` drops the blank separators when pickup or time
 * is missing.
 */
function formatWhatsApp(trip: DriverSheetTrip): string {
  const lines = [
    `🚗 *${trip.vehicleLabel ?? 'Trip'}*`,
    '',
    `Driver: ${trip.driverName ?? 'Not assigned'}`,
    `Contact: ${trip.driverMobile ?? 'N/A'}`,
    trip.scheduledTime ? `Time: ${new Date(trip.scheduledTime).toLocaleString()}` : '',
    trip.pickupPoint ? `Pickup: ${trip.pickupPoint}` : '',
    trip.dropPoint ? `Drop: ${trip.dropPoint}` : '',
    '',
    '*Families:*',
    ...trip.families.map(
      (f, i) => `${i + 1}. ${f.headName} — ${f.pax} PAX${f.contactNumber ? ` · ${f.contactNumber}` : ''}`,
    ),
  ]
  return lines.filter(Boolean).join('\n')
}

export default DriverSheetsBoard
