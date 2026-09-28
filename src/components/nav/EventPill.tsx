'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { CheckCircleIcon, ChevronDownIcon, GridIcon, PlusIcon } from '@/components/icons'
import { BottomSheet } from '@/components/ui/BottomSheet'
import { eventHomePath, type Membership } from '@/lib/events/paths'
import { cn } from '@/lib/utils'

export interface EventPillProps {
  event: { code: string; name: string }
  memberships: Membership[]
  isAdmin: boolean
}

/**
 * Where to go in ANOTHER event from where you are now (UI4 Part S, N9): the
 * same tab, so switching from Calls in one wedding lands on Calls in the
 * other. Control only survives the switch for an admin; a client always gets
 * their own one screen.
 */
export function switchTarget(pathname: string, target: Membership, isAdmin: boolean): string {
  if (!isAdmin && target.role === 'client') return eventHomePath(target, isAdmin)
  const seg = pathname.split('/').filter(Boolean)
  // /admin/events/{code}/… is Control's screen on a phone.
  const tab = seg[0] === 'admin' ? 'control' : seg[1]
  if (!tab || (tab === 'control' && !isAdmin)) return eventHomePath(target, isAdmin)
  return `/${target.eventCode}/${tab}`
}

/**
 * The current event, always on screen, one tap from switching.
 *
 * WHY (UI4 §1). The admin shell's own comment called editing the wrong
 * wedding "the single most dangerous mistake on this panel", and on a phone
 * the current event was not visible at all — the switcher sat three taps deep
 * in a More sheet (admin) or inside the account menu (the event app). This
 * pill replaces the header's date line with the event's code and name, and
 * opens the switcher as a sheet.
 */
export function EventPill({ event, memberships, isAdmin }: EventPillProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const others = memberships.filter((m) => m.eventCode !== event.code)
  const canSwitch = others.length > 0 || isAdmin

  const pill = (
    <>
      <span className="figure shrink-0 text-[0.6875rem] font-semibold tracking-wide text-ink">
        {event.code}
      </span>
      <span className="min-w-0 truncate text-muted">{event.name}</span>
      {canSwitch ? <ChevronDownIcon className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden /> : null}
    </>
  )

  const pillClass =
    'inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-rule bg-surface px-2.5 text-xs'

  if (!canSwitch) {
    return <span className={pillClass}>{pill}</span>
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Event: ${event.name}. Switch event`}
        className={cn(
          pillClass,
          'tap transition-colors duration-press ease-ledger active:bg-surface-2',
          pending && 'opacity-60',
        )}
      >
        {pill}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} label="Switch event">
        <h2 className="font-display text-2xl text-ink">Events</h2>
        <p className="mt-1 text-sm text-muted">
          You are working in <span className="font-semibold text-ink">{event.name}</span>.
        </p>

        <ul className="mt-4 overflow-hidden rounded-2xl border border-rule">
          {[
            memberships.find((m) => m.eventCode === event.code) ?? {
              eventId: event.code,
              eventCode: event.code,
              eventName: event.name,
              role: 'event_team' as const,
            },
            ...others,
          ].map((m) => {
            const current = m.eventCode === event.code
            return (
              <li key={m.eventCode} className="border-b border-rule last:border-b-0">
                <button
                  type="button"
                  disabled={current || pending}
                  onClick={() => {
                    setOpen(false)
                    startTransition(() => router.push(switchTarget(pathname, m, isAdmin)))
                  }}
                  className={cn(
                    'tap flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left',
                    current ? 'bg-brand-tint' : 'active:bg-surface-2',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-base font-medium text-ink">{m.eventName}</span>
                    <span className="figure block text-xs text-muted">{m.eventCode}</span>
                  </span>
                  {current ? <CheckCircleIcon className="h-5 w-5 shrink-0 text-brand" aria-label="Current event" /> : null}
                </button>
              </li>
            )
          })}
        </ul>

        {isAdmin ? (
          <div className="mt-4 flex flex-col gap-2">
            <Link
              href="/admin/events"
              onClick={() => setOpen(false)}
              className="tap flex min-h-12 items-center gap-3 rounded-2xl px-4 text-base font-medium text-ink active:bg-surface-2"
            >
              <GridIcon className="h-5 w-5 text-muted" aria-hidden />
              All events
            </Link>
            <Link
              href="/admin/events#new"
              onClick={() => setOpen(false)}
              className="tap flex min-h-12 items-center gap-3 rounded-2xl px-4 text-base font-medium text-brand active:bg-surface-2"
            >
              <PlusIcon className="h-5 w-5" aria-hidden />
              New event
            </Link>
          </div>
        ) : null}
      </BottomSheet>
    </>
  )
}

export default EventPill
