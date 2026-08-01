import type { Metadata } from 'next'
import Link from 'next/link'

import { EventPicker } from '@/components/admin/EventPicker'
import { ChevronLeftIcon } from '@/components/icons'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { friendlyDbError } from '@/lib/errors'
import { resolveAdminEvent } from '@/lib/events/adminEvent'
import { loadBackfillPlan } from '@/lib/rooms/load'
import { createClient } from '@/lib/supabase/server'

import { BackfillPanel } from './BackfillPanel'

export const metadata: Metadata = {
  title: 'Recover rooms from the import',
}

type PageProps = {
  searchParams: Promise<{ event?: string; hotel?: string; capacity?: string }>
}

const DEFAULT_CAPACITY = 2

/**
 * /admin/hotels/backfill — recover room allocations from the stored Excel rows.
 *
 * The import wrote every raw sheet row to `import_rows.raw`, including the
 * `Romm` and `bed` columns it parsed but never used. This screen reads them
 * back, so no re-upload is needed.
 *
 * Hotel and default capacity live in the query string rather than in client
 * state because they are *inputs to the plan*: changing either recomputes the
 * preview on the server, using the same code path the write uses. A plan
 * computed one way and applied another would make the confirmation
 * meaningless.
 */
export default async function BackfillPage({ searchParams }: PageProps) {
  const { event: eventCode, hotel: hotelId, capacity } = await searchParams
  const { events, selected, error } = await resolveAdminEvent(eventCode)

  if (error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{error}</CardBody>
      </Card>
    )
  }

  if (!selected) {
    return (
      <EventPicker
        events={events}
        basePath="/admin/hotels/backfill"
        title="Recover rooms"
        description="Pick an event to read its stored import rows."
      />
    )
  }

  const supabase = await createClient()
  const { data: hotels, error: hotelsError } = await supabase
    .from('hotels')
    .select('id, name')
    .eq('event_id', selected.id)
    .order('name', { ascending: true })

  if (hotelsError) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{friendlyDbError(hotelsError)}</CardBody>
      </Card>
    )
  }

  const backLink = (
    <Link
      href={`/admin/hotels?event=${encodeURIComponent(selected.code)}`}
      className="tap -ml-2 inline-flex w-fit items-center gap-1 rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
    >
      <ChevronLeftIcon className="h-5 w-5" />
      Hotels
    </Link>
  )

  const header = (
    <div>
      {backLink}
      <h1 className="mt-1 text-lg font-semibold text-fg">Recover rooms from the import</h1>
      <p className="text-sm text-muted">
        {selected.name} · {selected.code}
      </p>
    </div>
  )

  // The sheet never names a hotel, so one has to be chosen before anything
  // can be planned.
  if ((hotels ?? []).length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title="Add a hotel first"
          description="The Excel sheet has room numbers but no hotel name, so the recovered rooms need somewhere to live."
        />
        <LinkButton href={`/admin/hotels?event=${encodeURIComponent(selected.code)}`} size="lg" fullWidth>
          Add a hotel
        </LinkButton>
      </div>
    )
  }

  const chosen = hotels!.find((h) => h.id === hotelId) ?? null

  if (!chosen) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card>
          <CardHeader>
            <CardTitle>
              <p className="font-semibold text-fg">Which hotel are these rooms in?</p>
              <p className="text-xs text-muted">
                The sheet has room numbers but does not name a hotel.
              </p>
            </CardTitle>
          </CardHeader>
          <CardBody className="flex flex-col gap-2">
            {hotels!.map((h) => (
              <Link
                key={h.id}
                href={`/admin/hotels/backfill?event=${encodeURIComponent(selected.code)}&hotel=${h.id}`}
                className="tap flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 font-medium text-fg hover:bg-surface-2"
              >
                {h.name}
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>
    )
  }

  const parsedCapacity = Number(capacity)
  const defaultCapacity =
    Number.isSafeInteger(parsedCapacity) && parsedCapacity > 0 && parsedCapacity <= 20
      ? parsedCapacity
      : DEFAULT_CAPACITY

  const loaded = await loadBackfillPlan(selected.id, chosen.id, defaultCapacity)

  if (loaded.error) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm text-danger">{loaded.error}</CardBody>
        </Card>
      </div>
    )
  }

  if (loaded.plan.counts.rowsRead === 0) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title="No import rows stored"
          description="Nothing has been imported for this event yet, so there is nothing to recover. Run the Excel import first."
        />
      </div>
    )
  }

  if (!loaded.hasRoomData) {
    return (
      <div className="flex flex-col gap-4">
        {header}
        <EmptyState
          title="No room column in the imported sheet"
          description={`${loaded.plan.counts.rowsRead} rows were stored, but none of them carry a "Romm" or "Room" column. Add the rooms by hand, or re-import a sheet that has one.`}
        />
      </div>
    )
  }

  const base = `/admin/hotels/backfill?event=${encodeURIComponent(selected.code)}&hotel=${chosen.id}`

  return (
    <div className="flex flex-col gap-4">
      {header}

      <Card>
        <CardBody className="flex flex-col gap-3 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-muted">
              Hotel: <span className="font-semibold text-fg">{chosen.name}</span>
            </span>
            {hotels!.length > 1 ? (
              <Link
                href={`/admin/hotels/backfill?event=${encodeURIComponent(selected.code)}`}
                className="tap rounded-lg px-2 py-1 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
              >
                Change
              </Link>
            ) : null}
          </div>

          <div>
            <p className="text-sm text-muted">
              Capacity for rooms where the sheet&apos;s <code>bed</code> column is blank:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {[1, 2, 3, 4].map((n) => (
                <Link
                  key={n}
                  href={`${base}&capacity=${n}`}
                  className={
                    n === defaultCapacity
                      ? 'tap min-h-11 rounded-full border border-transparent bg-brand px-4 text-sm leading-[2.75rem] font-semibold text-brand-fg'
                      : 'tap min-h-11 rounded-full border border-border bg-surface px-4 text-sm leading-[2.75rem] font-semibold text-fg hover:bg-surface-2'
                  }
                >
                  {n} bed{n === 1 ? '' : 's'}
                </Link>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <BackfillPanel
        eventId={selected.id}
        eventCode={selected.code}
        hotelId={chosen.id}
        hotelName={chosen.name}
        defaultCapacity={defaultCapacity}
        plan={loaded.plan}
      />
    </div>
  )
}
