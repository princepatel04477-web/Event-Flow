/**
 * One source of truth for how `app.rsvp_status` is labelled and coloured.
 *
 * Three slices each grew their own copy of this map (the queue row, the call
 * screen, the review form) and they had already drifted — "Callback" vs
 * "Callback due", info vs warning. Field staff read these badges across
 * screens; they must not change meaning between them.
 *
 * Pure and browser-safe: no `server-only`, no Supabase client.
 */

import type { BadgeTone } from '@/components/ui/Badge'
import type { Database } from '@/lib/supabase/database.types'

export type RsvpStatus = Database['app']['Enums']['rsvp_status']

export const RSVP_STATUS_OPTIONS: RsvpStatus[] = [
  'not_started',
  'attempted',
  'callback',
  'tentative',
  'confirmed',
  'declined',
  'unreachable',
]

export const RSVP_STATUS_LABELS: Record<RsvpStatus, string> = {
  not_started: 'Not started',
  attempted: 'Attempted',
  callback: 'Callback',
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  declined: 'Declined',
  unreachable: 'Unreachable',
}

export const RSVP_STATUS_TONES: Record<RsvpStatus, BadgeTone> = {
  not_started: 'neutral',
  attempted: 'info',
  callback: 'warning',
  tentative: 'warning',
  confirmed: 'success',
  declined: 'danger',
  unreachable: 'danger',
}

function isRsvpStatus(value: string): value is RsvpStatus {
  return (RSVP_STATUS_OPTIONS as string[]).includes(value)
}

/** Label an rsvp_status that arrived as a loose string (a view column, AI output). */
export function rsvpStatusLabel(value: string | null | undefined): string {
  if (!value) return RSVP_STATUS_LABELS.not_started
  return isRsvpStatus(value) ? RSVP_STATUS_LABELS[value] : value
}

/** Badge tone for an rsvp_status that arrived as a loose string. */
export function rsvpStatusTone(value: string | null | undefined): BadgeTone {
  if (!value || !isRsvpStatus(value)) return 'neutral'
  return RSVP_STATUS_TONES[value]
}
