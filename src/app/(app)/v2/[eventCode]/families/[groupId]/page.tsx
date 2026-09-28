import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'

import { ChevronRightIcon } from '@/components/icons'
import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { mayOpenCallRecords, mayOpenHamperRun, sectionAllowedForDepartment } from '@/lib/departments'
import { familyNextAction, type FamilyAction } from '@/lib/family/next-action'
import { createClient } from '@/lib/supabase/server'
import { requireStaff, resolveEventByCode } from '@/lib/supabase/queries'
import { cn, formatDate, formatDateTime } from '@/lib/utils'

export const metadata: Metadata = { title: 'Family' }

type PageProps = { params: Promise<{ eventCode: string; groupId: string }> }

/** Plain words for the answer (R2) — not the enum's developer names. */
const ANSWER: Record<string, { label: string; tone: 'done' | 'wait' | 'ink' | 'muted' }> = {
  confirmed: { label: 'Coming', tone: 'done' },
  tentative: { label: 'Maybe', tone: 'wait' },
  callback: { label: 'Call back', tone: 'wait' },
  declined: { label: 'Not coming', tone: 'ink' },
  unreachable: { label: 'No answer', tone: 'muted' },
  attempted: { label: 'Tried, no answer yet', tone: 'muted' },
  not_started: { label: 'Not called yet', tone: 'muted' },
}

/** `app.travel_mode` in plain words. */
const MODE: Record<string, string> = {
  air: 'Flight',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Own car',
}

/** `app.call_outcome` in plain words. */
const OUTCOME: Record<string, string> = {
  connected: 'Spoke to them',
  no_answer: 'No answer',
  busy: 'Busy',
  switched_off: 'Phone off',
  wrong_number: 'Wrong number',
  callback: 'Asked for a call back',
  declined: 'Not coming',
  other: 'Other',
}

/** Today's date where the wedding is. The server runs in Seoul; the guests are in Gujarat. */
function todayInIndia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
}

/**
 * One family, everything about them, on one screen (UI4 Part S, S4).
 *
 * Before this page a family's facts were split across six screens — the RSVP
 * status form, the call screen, the guest card, the rooms board, the arrivals
 * row and the hamper proof — and "where is the Shah family, what room, did
 * they land, did they get their hamper" was four searches. Every "open this
 * family" link can now land here.
 *
 * Its ONE primary action changes with where the family is in the event
 * (`familyNextAction`): Call → Call back → Check in → Deliver hamper → none.
 *
 * READS. The same per-family reads the RSVP status screen already makes
 * (group, legs, attempts) plus the family's active room assignments and its
 * group hamper, all in parallel (T5). RLS fences every one of them by event;
 * nothing new is exposed. A section the viewer's department may not open is
 * not rendered — the same predicates the section guards use, no new
 * permission logic.
 */
export default async function FamilyPage({ params }: PageProps) {
  const { eventCode, groupId } = await params
  const event = await resolveEventByCode(eventCode)
  if (!event) notFound()

  const access = await requireStaff(event.id, event.code)
  const ctx = await getStaffViewerContext(event.id)
  const department = ctx?.department ?? null
  const lead = access === 'admin' || department === 'management'

  const can = {
    answer: lead || mayOpenCallRecords(access, department),
    travel: lead || sectionAllowedForDepartment('logistics', department),
    stay: lead || sectionAllowedForDepartment('hospitality', department),
    hamper: lead || mayOpenHamperRun(department),
  }

  const supabase = await createClient()
  const [groupRes, guestsRes, legsRes, attemptsRes, staysRes, hamperRes] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id, head_name, city, side, rsvp_status, expected_pax, confirmed_pax, callback_at, primary_mobile, remarks, special_requirements, locked_until')
      .eq('id', groupId)
      .eq('event_id', event.id)
      .maybeSingle(),
    supabase
      .from('guests')
      .select('id, full_name, is_head')
      .eq('group_id', groupId)
      .eq('event_id', event.id),
    supabase
      .from('travel_legs')
      .select('id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg, arrived_at, departed_at')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .order('travel_date', { ascending: true, nullsFirst: false }),
    supabase
      .from('call_attempts')
      .select('id, started_at, outcome, notes, callback_at')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .order('started_at', { ascending: false })
      .limit(10),
    supabase
      .from('room_assignments')
      .select('id, room_id, check_in_date, check_out_date, checked_in_at, rooms(room_number, hotels(name))')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .is('released_at', null),
    supabase
      .from('deliverables')
      .select('id, status, item_name')
      .eq('group_id', groupId)
      .eq('event_id', event.id)
      .eq('kind', 'hamper')
      .is('guest_id', null)
      .maybeSingle(),
  ])

  const group = groupRes.data
  if (!group) notFound()

  const legs = legsRes.data ?? []
  const stays = staysRes.data ?? []
  const hamper = hamperRes.data ?? null
  const today = todayInIndia()
  const checkedIn = stays.some((s) => s.checked_in_at !== null)

  const action = familyNextAction(
    {
      rsvpStatus: group.rsvp_status,
      callbackAt: group.callback_at,
      arrivingToday: legs.some((l) => l.direction === 'arrival' && l.travel_date === today),
      checkedIn,
      hamperStatus: hamper?.status ?? null,
    },
    { canCall: can.answer, canCheckIn: can.stay, canDeliver: can.hamper },
  )

  const e = event.code
  const actionLink: Record<Exclude<FamilyAction, null>, { href: string; label: string }> = {
    call: { href: `/${e}/rsvp/call/${group.id}`, label: `Call ${group.head_name?.split(' ')[0] ?? 'the family'}` },
    'call-back': {
      href: `/${e}/rsvp/call/${group.id}`,
      label: group.callback_at ? `Call back · promised ${formatDateTime(group.callback_at) ?? ''}` : 'Call back',
    },
    'check-in': { href: `/${e}/hospitality/checkin`, label: 'Check in' },
    'deliver-hamper': { href: hamper ? `/${e}/hamper/${hamper.id}` : `/${e}/hamper`, label: 'Deliver hamper' },
  }

  const answer = ANSWER[group.rsvp_status ?? 'not_started'] ?? ANSWER.not_started
  const guestsComing = group.confirmed_pax ?? null
  const members = (guestsRes.data ?? []).filter((g) => !g.is_head && g.full_name?.trim())
  // `special_requirements` is `text[] not null default '{}'`: an empty array is
  // truthy, so test its length, and join it — React would run the items together.
  const needs = (group.special_requirements ?? []).filter((s) => s.trim())

  return (
    <div className="flex flex-col gap-5 pb-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {[group.city, group.side ? `${group.side}'s side` : null].filter(Boolean).join(' · ') || 'Family'}
        </p>
        <h1 className="font-display text-[2.5rem] leading-[1.05] text-ink">{group.head_name ?? 'Unnamed family'}</h1>
        {group.primary_mobile && can.answer ? (
          <p className="code-figure text-sm text-muted">{group.primary_mobile}</p>
        ) : null}
      </header>

      {action ? (
        <Link
          href={actionLink[action].href}
          className={cn(
            'tap flex min-h-16 items-center justify-center rounded-2xl px-5 text-lg font-semibold',
            'transition-[background-color,transform] duration-press ease-ledger active:scale-[0.98]',
            action === 'call' || action === 'call-back'
              ? 'bg-highlight text-highlight-fg'
              : 'bg-brand text-brand-fg active:bg-brand-hover',
          )}
        >
          {actionLink[action].label}
        </Link>
      ) : null}

      {can.answer ? (
        <Section id="answer" title="Answer" href={`/${e}/rsvp/status/${group.id}`} linkLabel="Log an answer">
          <div className="flex items-baseline justify-between gap-3">
            <span
              className={cn(
                'text-xl font-semibold',
                answer.tone === 'done' && 'text-ledger-green',
                answer.tone === 'wait' && 'text-ledger-amber',
                answer.tone === 'ink' && 'text-ink line-through decoration-1',
                answer.tone === 'muted' && 'text-muted',
              )}
            >
              {answer.label}
            </span>
            <span className="figure text-base text-ink">
              {guestsComing !== null ? `${guestsComing} of ` : ''}
              {group.expected_pax ?? '?'} guests
            </span>
          </div>
          {group.callback_at ? (
            <p className="mt-1 text-sm text-ledger-amber">Promised a call back {formatDateTime(group.callback_at)}</p>
          ) : null}
          {group.locked_until && new Date(group.locked_until) > new Date() ? (
            <p className="mt-1 text-sm text-muted">Someone is logging this family until {formatDateTime(group.locked_until, { hour: '2-digit', minute: '2-digit', hour12: false })}</p>
          ) : null}
        </Section>
      ) : null}

      {can.travel ? (
        <Section id="travel" title="Travel" href={`/${e}/logistics/arrivals`} linkLabel="Arrivals">
          {legs.length === 0 ? (
            <p className="text-base text-muted">No travel details yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {legs.map((l) => (
                <li key={l.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-medium text-ink">
                      {l.direction === 'arrival' ? 'Arrives' : 'Leaves'}
                      {l.travel_date ? ` ${formatDate(l.travel_date)}` : ''}
                      {l.travel_time ? ` · ${l.travel_time.slice(0, 5)}` : ''}
                    </p>
                    <p className="truncate text-sm text-muted">
                      {[l.mode ? MODE[l.mode] ?? l.mode : null, l.reference, l.point].filter(Boolean).join(' · ') ||
                        'Details not given'}
                    </p>
                  </div>
                  {l.arrived_at || l.departed_at ? (
                    <span className="shrink-0 rounded-full bg-green-tint px-2.5 py-1 text-xs font-semibold text-ledger-green">
                      {l.arrived_at ? 'Landed' : 'Left'}
                    </span>
                  ) : l.direction === 'arrival' && l.travel_date === today ? (
                    <span className="shrink-0 rounded-full bg-highlight px-2.5 py-1 text-xs font-semibold text-highlight-fg">
                      Today
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {can.stay ? (
        <Section id="stay" title="Stay" href={`/${e}/hospitality/rooms`} linkLabel="Rooms">
          {stays.length === 0 ? (
            <p className="text-base text-muted">No room yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {groupStays(stays).map((s) => (
                <li key={s.key} className="flex flex-col">
                  <span className="text-lg text-ink">
                    Room <span className="figure font-semibold">{s.room}</span>
                    {s.checkedIn ? (
                      <span className="ml-2 rounded-full bg-green-tint px-2 py-0.5 align-middle text-xs font-semibold text-ledger-green">
                        Checked in
                      </span>
                    ) : null}
                  </span>
                  <span className="truncate text-sm text-muted">
                    {[s.hotel, `${s.beds} ${s.beds === 1 ? 'guest' : 'guests'}`].filter(Boolean).join(' · ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {can.hamper ? (
        <Section id="hamper" title="Hamper" href={hamper ? `/${e}/hamper/${hamper.id}` : `/${e}/hamper`} linkLabel="Open">
          <p
            className={cn(
              'text-base',
              hamper?.status === 'delivered' ? 'font-semibold text-ledger-green' : 'text-ink',
            )}
          >
            {!hamper
              ? 'No hamper for this family.'
              : hamper.status === 'delivered'
                ? 'Delivered'
                : hamper.status === 'not_required'
                  ? 'Not needed'
                  : 'Not delivered yet'}
          </p>
        </Section>
      ) : null}

      {can.answer ? (
        <Section id="calls" title="Calls" href={`/${e}/rsvp/queue`} linkLabel="Call list">
          {(attemptsRes.data ?? []).length === 0 ? (
            <p className="text-base text-muted">Nobody has called them yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {(attemptsRes.data ?? []).map((a) => (
                <li key={a.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-base text-ink">
                    {a.outcome ? OUTCOME[a.outcome] ?? a.outcome : 'Call not finished'}
                    {a.notes ? <span className="text-muted"> · {a.notes}</span> : null}
                  </span>
                  <span className="figure shrink-0 text-sm text-muted">{formatDateTime(a.started_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      {members.length > 0 ? (
        <Section id="people" title="People">
          <p className="text-base text-ink">{members.map((m) => m.full_name).join(', ')}</p>
        </Section>
      ) : null}

      {group.remarks || needs.length > 0 ? (
        <Section id="notes" title="Notes">
          {needs.length > 0 ? <p className="text-base text-ink">{needs.join(' · ')}</p> : null}
          {group.remarks ? <p className="mt-1 text-base text-muted">{group.remarks}</p> : null}
        </Section>
      ) : null}
    </div>
  )
}

/** One card on the family page. `id` is the anchor deep links use (N8). */
function Section({
  id,
  title,
  href,
  linkLabel,
  children,
}: {
  id: string
  title: string
  href?: string
  linkLabel?: string
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-rule bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="eyebrow">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="tap -my-2 -mr-2 flex min-h-11 items-center gap-0.5 rounded-full px-2 text-sm font-medium text-brand active:bg-brand-tint"
          >
            {linkLabel ?? 'Open'}
            <ChevronRightIcon className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  )
}

type StayRow = {
  room_id: string
  checked_in_at: string | null
  rooms: { room_number: string | null; hotels: { name: string | null } | null } | null
}

/** Beds per room: a family of six in two rooms is two lines, not six. */
function groupStays(stays: StayRow[]) {
  const byRoom = new Map<string, { key: string; room: string; hotel: string | null; beds: number; checkedIn: boolean }>()
  for (const s of stays) {
    const row = byRoom.get(s.room_id) ?? {
      key: s.room_id,
      room: s.rooms?.room_number ?? '?',
      hotel: s.rooms?.hotels?.name ?? null,
      beds: 0,
      checkedIn: false,
    }
    row.beds += 1
    row.checkedIn = row.checkedIn || s.checked_in_at !== null
    byRoom.set(s.room_id, row)
  }
  return [...byRoom.values()]
}
