import type { Metadata } from 'next'
import Link from 'next/link'

import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { friendlyDbError } from '@/lib/errors'
import { createClient } from '@/lib/supabase/server'
import type { ExportData } from '@/lib/export/workbook'

import { ExportPanel } from './ExportPanel'

export const metadata: Metadata = {
  title: 'Export',
}

type PageProps = {
  searchParams: Promise<{ event?: string }>
}

/**
 * /admin/export — the Excel way out.
 *
 * Admin-only by inheritance: the `(admin)` layout has already established
 * `global_role = 'admin'` before this renders. Nothing here re-checks it,
 * because RLS is the real fence — a non-admin who reached this URL would get
 * an event list of exactly the events they belong to and rows to match.
 *
 * The event comes from `?event=CODE` rather than the path, because this route
 * group deliberately sits above the `/{eventCode}` tenancy segment.
 */
export default async function AdminExportPage({ searchParams }: PageProps) {
  const { event: eventCode } = await searchParams
  const supabase = await createClient()

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, name, code')
    .order('created_at', { ascending: false })

  if (eventsError) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{friendlyDbError(eventsError)}</CardBody>
      </Card>
    )
  }

  const selected = eventCode ? (events ?? []).find((e) => e.code === eventCode) : undefined

  if (!selected) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-lg font-semibold text-fg">Export</h1>
          <p className="mt-1 text-sm text-muted">Pick an event to export.</p>
        </div>

        {(events ?? []).length === 0 ? (
          <EmptyState
            title="No events yet"
            description="Create an event before exporting anything."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {(events ?? []).map((e) => (
              <li key={e.id}>
                <Link href={`/admin/export?event=${encodeURIComponent(e.code)}`} className="block">
                  <Card className="transition-colors hover:bg-surface-2 active:bg-surface-2">
                    <CardBody className="py-3">
                      <p className="font-semibold text-fg">{e.name}</p>
                      <p className="text-sm text-muted">{e.code}</p>
                    </CardBody>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // Five reads rather than one join: PostgREST would nest these as objects
  // per row, and the flat shape is what the column specs consume. At ~238
  // families and ~465 guests the whole export is a few hundred kilobytes.
  const [groupsRes, guestsRes, legsRes, roomsRes, deliverablesRes] = await Promise.all([
    supabase
      .from('guest_groups')
      .select(
        'id, group_code, head_name, primary_mobile, alt_mobile, side, group_type, city, expected_pax, confirmed_pax, rsvp_status, needs_return_gift, remarks',
      )
      .eq('event_id', selected.id),
    supabase
      .from('guests')
      .select('id, group_id, full_name, mobile, is_head, age_band, notes')
      .eq('event_id', selected.id),
    supabase
      .from('travel_legs')
      .select(
        'group_id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg, needs_transport, notes, created_at',
      )
      .eq('event_id', selected.id)
      .order('created_at', { ascending: true }),
    supabase
      .from('room_assignments')
      .select('guest_id, group_id, check_in_date, check_out_date, rooms(room_number, hotels(name))')
      .eq('event_id', selected.id)
      // Only live allocations. A released assignment is history, and showing
      // it would put a guest in a room somebody else is now standing in.
      .is('released_at', null),
    supabase
      .from('deliverables')
      .select('group_id, guest_id, kind, status')
      .eq('event_id', selected.id),
  ])

  const failure = [groupsRes, guestsRes, legsRes, roomsRes, deliverablesRes].find((r) => r.error)
  if (failure?.error) {
    return (
      <Card className="border-danger/40 bg-tint-danger">
        <CardBody className="py-3 text-sm text-danger">{friendlyDbError(failure.error)}</CardBody>
      </Card>
    )
  }

  type RoomJoin = {
    guest_id: string
    group_id: string
    check_in_date: string | null
    check_out_date: string | null
    rooms: { room_number: string | null; hotels: { name: string } | null } | null
  }

  const data: ExportData = {
    groups: groupsRes.data ?? [],
    guests: guestsRes.data ?? [],
    legs: legsRes.data ?? [],
    rooms: ((roomsRes.data ?? []) as unknown as RoomJoin[]).map((r) => ({
      guest_id: r.guest_id,
      group_id: r.group_id,
      hotel_name: r.rooms?.hotels?.name ?? null,
      room_number: r.rooms?.room_number ?? null,
      check_in_date: r.check_in_date,
      check_out_date: r.check_out_date,
    })),
    deliverables: deliverablesRes.data ?? [],
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link
          href="/admin/export"
          className="tap -ml-2 inline-flex w-fit rounded-xl px-2 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg"
        >
          Change event
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-fg">{selected.name}</h1>
        <p className="text-sm text-muted">{selected.code}</p>
      </div>

      <ExportPanel eventCode={selected.code} data={data} />
    </div>
  )
}
