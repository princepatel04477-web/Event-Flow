'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { CameraIcon, RefreshIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { PageTitle } from '@/components/ui/PageTitle'
import { StampPill } from '@/components/ui/StatusPill'
import {
  generateDeliverables,
  readDeliveryRun,
  type DeliveryRunRow,
} from '@/lib/actions/deliveries'
import { traceFetch } from '@/lib/perf'

/**
 * The delivery run (R1): every deliverable for the event, filterable by
 * hotel and sortable by room number so a staff member can walk a floor in
 * order. Shows delivered/pending counts per hotel.
 *
 * Admin gets a "Generate deliverables" control — the only way hamper /
 * return-gift rows are created. Idempotent: re-running never duplicates.
 */

export interface DeliveryListProps {
  eventId: string
  eventCode: string
  canImport: boolean // admin — shows the generate control
  /**
   * Route segment this list lives under, so a row links to a detail screen in
   * the SAME section. Defaults to the hospitality tree it was written in.
   *
   * Without this the link was hardcoded to `/hospitality/deliveries/…`, so
   * opening a hamper from the Hamper tab navigated into Hospitality and the
   * bottom bar switched tabs underneath the person using it.
   */
  detailBase?: string
}

const KIND_LABEL: Record<string, string> = { hamper: 'Hamper', return_gift: 'Return gift' }

export function DeliveryList({
  eventId,
  eventCode,
  canImport,
  detailBase = 'hospitality/deliveries',
}: DeliveryListProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const hotelFilter = searchParams.get('hotel') ?? 'all'
  const kindFilter = searchParams.get('kind') ?? 'all'

  const [rows, setRows] = useState<DeliveryRunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [genResult, setGenResult] = useState<string | null>(null)
  // Bumped by the refresh/generate buttons to re-run the load effect.
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const res = await traceFetch('deliveries :: readDeliveryRun', () => readDeliveryRun(eventId))
      if (cancelled) return
      if (!res.ok) {
        setError(res.error)
        setRows([])
        return
      }
      setError(null)
      setRows(res.rows)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [eventId, reloadToken])

  const hotels = useMemo(() => {
    const set = new Map<string, { total: number; delivered: number }>()
    for (const r of rows ?? []) {
      const key = r.hotel_name ?? '(no hotel)'
      const cur = set.get(key) ?? { total: 0, delivered: 0 }
      cur.total += 1
      if (r.status === 'delivered') cur.delivered += 1
      set.set(key, cur)
    }
    return [...set.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows])

  const filtered = useMemo(() => {
    const list = (rows ?? []).filter((r) => {
      if (hotelFilter !== 'all' && (r.hotel_name ?? '(no hotel)') !== hotelFilter) return false
      if (kindFilter !== 'all' && r.kind !== kindFilter) return false
      return true
    })
    // Sort by hotel, then floor, then room number.
    return list.sort((a, b) => {
      const h = (a.hotel_name ?? '').localeCompare(b.hotel_name ?? '')
      if (h !== 0) return h
      const f = (a.floor ?? '').localeCompare(b.floor ?? '')
      if (f !== 0) return f
      return (a.room_number ?? '').localeCompare(b.room_number ?? '')
    })
  }, [rows, hotelFilter, kindFilter])

  const setFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete(key)
    else params.set(key, value)
    router.replace(params.toString() ? `${pathname}?${params}` : pathname, { scroll: false })
  }

  async function handleGenerate() {
    setBusy(true)
    setGenResult(null)
    const res = await generateDeliverables(eventId)
    setBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    setGenResult(
      `Created ${res.summary.hampersCreated} hamper${res.summary.hampersCreated === 1 ? '' : 's'}, ` +
        `${res.summary.returnGiftsCreated} return gift${res.summary.returnGiftsCreated === 1 ? '' : 's'}. ` +
        `${res.summary.existingHampers} hamper${res.summary.existingHampers === 1 ? '' : 's'} and ` +
        `${res.summary.existingReturnGifts} return gift${res.summary.existingReturnGifts === 1 ? '' : 's'} already existed.`,
    )
    setReloadToken((n) => n + 1)
  }

  const pendingCount = (rows ?? []).filter((r) => r.status !== 'delivered').length

  if (rows === null && !error) {
    // Loading: skeleton shaped like the summary card + row list, so the
    // screen does not flash "0 pending" while the fetch is in flight.
    return (
      <div className="flex flex-col gap-4">
        <PageTitle>Delivery run</PageTitle>
        <div className="rounded-2xl border border-rule bg-surface p-4">
          <div className="h-6 w-24 rounded bg-rule-strong" />
          <div className="mt-2 h-4 w-40 rounded bg-rule" />
        </div>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-2xl border border-rule bg-surface p-4">
            <div className="flex items-center gap-2">
              <div className="h-5 w-2/5 rounded bg-rule-strong" />
              <div className="h-5 w-16 rounded-full bg-rule" />
            </div>
            <div className="mt-2 h-4 w-1/3 rounded bg-rule" />
            <div className="mt-3 space-y-1.5">
              <div className="h-4 w-3/4 rounded bg-rule" />
              <div className="h-4 w-1/2 rounded bg-rule" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  const deliveredCount = (rows ?? []).filter((r) => r.status === 'delivered').length

  return (
    <div className="flex flex-col gap-4">
      {/* Title and actions stack rather than share a row: at 360px
          "Delivery run" + its sealed count + Generate + Refresh cannot fit
          side by side, and squeezing them clipped the count behind the
          button. The count is the number people came for, so it keeps the
          full-width line. */}
      <div className="flex flex-col gap-3">
        <PageTitle right={`${deliveredCount} sealed`}>Delivery run</PageTitle>
        {canImport ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              fullWidth
              loading={busy}
              onClick={() => void handleGenerate()}
            >
              Generate
            </Button>
            <Button
              variant="ghost"
              onClick={() => setReloadToken((n) => n + 1)}
              aria-label="Refresh"
              className="shrink-0 border-rule-strong"
            >
              <RefreshIcon className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        ) : null}
      </div>

      <p className="text-sm leading-snug text-muted">
        A hamper is delivered because a photo exists. Not because someone tapped a button.
        <span className="figure ml-1.5 text-ink">{pendingCount}</span> still queued.
      </p>

      {genResult ? (
        <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-ink">
          {genResult}
        </p>
      ) : null}
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          <ShieldAlertIcon className="mr-1 inline h-4 w-4" aria-hidden />
          {error}
        </p>
      ) : null}

      {/* Hotel filter chips */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by hotel">
        <Chip selected={hotelFilter === 'all'} onClick={() => setFilter('hotel', 'all')}>
          All hotels
        </Chip>
        {hotels.map(([name, counts]) => (
          <Chip
            key={name}
            selected={hotelFilter === name}
            onClick={() => setFilter('hotel', hotelFilter === name ? 'all' : name)}
          >
            {name} · {counts.delivered}/{counts.total}
          </Chip>
        ))}
      </div>

      {/* Kind filter */}
      <div className="flex gap-2" role="group" aria-label="Filter by kind">
        <Chip selected={kindFilter === 'all'} onClick={() => setFilter('kind', 'all')}>
          All kinds
        </Chip>
        {(['hamper', 'return_gift'] as const).map((k) => (
          <Chip
            key={k}
            selected={kindFilter === k}
            onClick={() => setFilter('kind', kindFilter === k ? 'all' : k)}
          >
            {KIND_LABEL[k]}
          </Chip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-2xl border border-rule bg-surface px-4 py-10 text-center text-muted">
          {canImport
            ? 'No deliveries yet. Tap Generate to create hampers and return gifts from the guest list.'
            : 'No deliveries for this filter.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtered.map((r, i) => (
            <li key={r.id} style={{ animationDelay: `${Math.min(i, 8) * 45}ms` }}>
              <DeliveryRunCard row={r} eventCode={eventCode} detailBase={detailBase} />
            </li>
          ))}
        </ul>
      )}

      <p className="text-center text-xs leading-relaxed text-muted">
        Queued rows carry an action. Sealed rows carry none — a photo exists, and there is
        nothing left to do to them.
      </p>
    </div>
  )
}

/**
 * One row of the run, in one of exactly two states.
 *
 * The two states are drawn to be unmistakable from a metre away while
 * walking a corridor, and they differ in more than colour:
 *
 * - SEALED is filled, solid-bordered, still, and carries no button. A
 *   photo exists; the row is finished and immutable at the database level.
 * - QUEUED is unfilled, dashed, breathing, and carries the one action. The
 *   dashes read as "not written yet" the way a dotted line on a form does.
 *
 * That asymmetry is the whole screen. A hamper is delivered because a photo
 * exists — not because somebody tapped a button — so "done" has to look
 * like a record and "not done" has to look like a blank waiting to be
 * filled.
 */
function DeliveryRunCard({ row, eventCode, detailBase }: { row: DeliveryRunRow; eventCode: string; detailBase: string }) {
  const sealed = row.status === 'delivered'
  const place = [row.hotel_name, row.room_number ? `Room ${row.room_number}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <Link
      href={`/${eventCode}/${detailBase}/${row.id}`}
      className={`list-fade tap block rounded-xl p-3.5 transition-colors duration-press ease-ledger ${
        sealed
          ? 'border border-ledger-green/35 border-l-4 border-l-ledger-green bg-green-tint active:bg-green-tint/70'
          : 'border-2 border-dashed border-muted/45 active:bg-surface-2'
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={
            sealed
              ? 'seal-in relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-full border-[1.5px] border-brand bg-brand-tint'
              : 'breathe flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dotted border-muted/50'
          }
        >
          {sealed ? (
            <>
              <span className="font-display text-[0.5rem] leading-none tracking-[0.14em] text-brand">
                SEALED
              </span>
              <span className="mt-0.5 h-1 w-1 rounded-full bg-ledger-green" />
            </>
          ) : (
            <span className="h-2 w-2 rounded-full border-[1.5px] border-muted" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            {row.room_number ? (
              <span className="figure text-lg leading-none font-medium text-ink">
                {row.room_number}
              </span>
            ) : null}
            <span className="min-w-0 truncate text-base leading-snug font-medium text-ink">
              {row.head_name ?? 'Unknown family'}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {sealed ? (
              <StampPill>Delivered</StampPill>
            ) : (
              <span className="inline-flex items-center rounded-md border-[1.5px] border-dashed border-muted/60 px-2.5 py-1 font-mono text-[0.625rem] font-semibold tracking-eyebrow text-muted uppercase">
                Queued
              </span>
            )}
            <span className="text-xs text-muted">
              {sealed ? 'photo proof on file' : 'no proof on file'}
            </span>
          </div>

          <p className="mt-2 text-sm text-muted">
            {place || 'No room'} · {KIND_LABEL[row.kind] ?? row.kind}
            {row.item_name ? ` · ${row.item_name}` : ''}
          </p>
        </div>

        {/* The proof slot: a filled hatch once a photo exists, an empty
            dashed frame while it does not. */}
        <span
          aria-hidden
          className={`h-13 w-11 shrink-0 rounded-lg ${
            sealed
              ? 'border border-rule-strong bg-[repeating-linear-gradient(52deg,var(--ef-rule)_0_3px,transparent_3px_7px)]'
              : 'border-[1.5px] border-dashed border-muted/35'
          }`}
        />
      </div>

      {!sealed ? (
        <span className="tap mt-3 flex min-h-12 items-center justify-center gap-2 rounded-lg border border-brand/50 bg-brand-tint font-semibold text-brand">
          <CameraIcon className="h-4 w-4" aria-hidden />
          Capture proof
        </span>
      ) : null}
    </Link>
  )
}

export default DeliveryList
