'use client'

import { useRouter } from 'next/navigation'
import { useTransition, type ChangeEvent } from 'react'

import { ChevronDownIcon, SwitchIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import type { Membership } from '@/lib/supabase/queries'

export interface EventSwitcherProps {
  events: Pick<Membership, 'eventId' | 'eventCode' | 'eventName'>[]
  /** Canonical code of the event currently open. */
  currentCode: string
}

/**
 * Jump between events without going back to the picker.
 *
 * A native <select> on purpose — the OS wheel is the only picker that stays
 * one-handed on a cheap Android phone, and it needs no JS to open. It is laid
 * transparently over the visible chip so the trigger keeps a 44px target
 * without fighting platform select styling.
 */
export function EventSwitcher({ events, currentCode }: EventSwitcherProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const code = event.target.value
    if (!code || code === currentCode) return

    startTransition(() => {
      router.push(`/${code}`)
    })
  }

  return (
    <span
      className={cn(
        'relative inline-flex min-h-11 items-center gap-0.5 rounded-xl px-2 text-muted',
        'hover:bg-surface-2 focus-within:bg-surface-2',
        pending && 'opacity-60',
      )}
    >
      <SwitchIcon className="h-5 w-5" aria-hidden />
      <ChevronDownIcon className="h-4 w-4" aria-hidden />

      <select
        aria-label="Switch event"
        value={currentCode}
        onChange={handleChange}
        disabled={pending}
        className="tap absolute inset-0 h-full w-full cursor-pointer opacity-0"
      >
        {events.map((option) => (
          <option key={option.eventId} value={option.eventCode}>
            {option.eventName} ({option.eventCode})
          </option>
        ))}
      </select>
    </span>
  )
}

export default EventSwitcher
