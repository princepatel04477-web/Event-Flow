import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { notFound, redirect } from 'next/navigation'

import { ArchiveEventCard } from '@/app/(admin)/admin/events/[eventCode]/ArchiveEventCard'
import {
  BuildingIcon,
  DownloadIcon,
  FileTextIcon,
  IndianRupeeIcon,
  ListIcon,
  LockIcon,
  MessageCircleIcon,
  SlidersIcon,
  UploadIcon,
  UsersIcon,
} from '@/components/icons'
import { controlGroups, type ControlRowKey } from '@/lib/admin/control'
import { isArrivalsNotifyEnabled } from '@/lib/actions/arrivals'
import { readHotelImportContext } from '@/lib/actions/import-hotels'
import { readSectionLocks } from '@/lib/actions/section-locks'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { formatDateRange } from '@/lib/utils'

import { ControlList, type ControlGroup } from './ControlList'
import { VersionRow } from './VersionRow'

export const metadata: Metadata = { title: 'Control' }

type PageProps = { params: Promise<{ eventCode: string }> }

/**
 * Control — every admin tool for this event, one tap from the bar.
 *
 * WHY THIS SCREEN EXISTS (UI4 Part S, §1). On a phone the admin used to leave
 * "the App" for a second shell with its own header and a four-tab bar
 * (Events · Dashboard · Msgs · More), and five of the seven event tools —
 * access codes among them — sat behind More, with the event switcher three
 * taps deep in the same sheet. This list replaces all of that: one grouped
 * list, iOS-Settings shaped, every row one tap to its tool.
 *
 * The rows link to the EXISTING admin screens (`/admin/events/{code}/…`);
 * nothing about how a tool works changes here. Counts are read in parallel
 * (one round trip's worth of latency, T5) and a count this screen cannot read
 * cheaply is simply left off its row rather than guessed.
 *
 * ADMIN ONLY. `requireSection` admits management as well, so the gate is the
 * access level itself: a lead who is not an admin is sent back to Today with
 * the standard denied note, never shown a screen of tools that would refuse
 * every write.
 */
export default async function ControlPage({ params }: PageProps) {
  const { eventCode } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await requireStaff(event.id, event.code)
  if (access !== 'admin') redirect(`/${event.code}?denied=admin`)

  const supabase = await createClient()
  const [staffCount, liveCodes, hotels, locks, arrivalsOn, templateCount] = await Promise.all([
    supabase
      .from('staff_members')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .then((r) => r.count ?? null),
    supabase
      .from('event_access_codes')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .is('revoked_at', null)
      .is('rotated_at', null)
      .then((r) => r.count ?? null),
    readHotelImportContext(event.id),
    readSectionLocks(event.id),
    isArrivalsNotifyEnabled(event.id),
    supabase
      .from('message_templates')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', event.id)
      .then((r) => r.count ?? null),
  ])

  const base = `/admin/events/${event.code}`
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
  const lockedCount = Object.values(locks).filter(Boolean).length

  // Where each row goes lives in `@/lib/admin/control` (a test walks it); what
  // each row SAYS about the event right now is this page's job.
  const values: Partial<Record<ControlRowKey, string>> = {
    staff: staffCount === null ? undefined : plural(staffCount, 'person', 'people'),
    codes: liveCodes === null ? undefined : `${liveCodes} live`,
    hotels: hotels.ok
      ? `${plural(hotels.existingHotels, 'hotel', 'hotels')} · ${plural(hotels.existingRooms, 'room', 'rooms')}`
      : undefined,
    templates: templateCount === null ? undefined : String(templateCount),
    locks: lockedCount === 0 ? 'None' : `${lockedCount} locked`,
    alerts: arrivalsOn ? 'On' : 'Off',
  }
  const icons: Record<ControlRowKey, ReactNode> = {
    staff: <UsersIcon className="h-5 w-5" />,
    codes: <LockIcon className="h-5 w-5" />,
    import: <UploadIcon className="h-5 w-5" />,
    export: <DownloadIcon className="h-5 w-5" />,
    files: <FileTextIcon className="h-5 w-5" />,
    hotels: <BuildingIcon className="h-5 w-5" />,
    send: <MessageCircleIcon className="h-5 w-5" />,
    templates: <FileTextIcon className="h-5 w-5" />,
    sent: <ListIcon className="h-5 w-5" />,
    ledger: <IndianRupeeIcon className="h-5 w-5" />,
    locks: <LockIcon className="h-5 w-5" />,
    alerts: <SlidersIcon className="h-5 w-5" />,
  }
  const groups: ControlGroup[] = controlGroups(event.code).map((g) => ({
    title: g.title,
    rows: g.rows.map((r) => ({ ...r, value: values[r.key], icon: icons[r.key] })),
  }))

  const dates = formatDateRange(event.starts_on ?? null, event.ends_on ?? null)

  return (
    <div className="flex flex-col gap-6 pb-4">
      {/* The header already says "Control" and the pill names the event; the
          dates are the one fact neither carries. */}
      {dates ? <p className="-mt-1 text-sm text-muted">{event.name} · {dates}</p> : null}

      {staffCount === 0 ? (
        <a
          href={`${base}/staff`}
          className="tap block rounded-2xl border border-ledger-amber/40 bg-amber-tint px-4 py-3 text-sm font-medium text-ledger-amber"
        >
          No staff names yet — calls and photos will be saved against nobody. Add staff →
        </a>
      ) : null}

      <ControlList groups={groups} />

      {/* Last, alone, after a gap: nothing routine lives below it, so the
          archive control is never something a thumb passes over on the way
          to a task. Same component the admin dashboard used. */}
      <div className="mt-6">
        <ArchiveEventCard
          eventId={event.id}
          eventName={event.name}
          eventCode={event.code}
          archivedAt={event.archived_at ?? null}
        />
      </div>

      <VersionRow />
    </div>
  )
}
