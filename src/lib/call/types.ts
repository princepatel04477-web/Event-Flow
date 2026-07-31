/**
 * Shared types for the call screen (p1f). Kept dependency-free and free of
 * `server-only` / `next/headers` so both server and client code can import it.
 */
import type { Database } from '@/lib/supabase/database.types'

export type CallOutcome = Database['app']['Enums']['call_outcome']
export type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']
export type CallAttemptRow = Database['public']['Tables']['call_attempts']['Row']
export type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']

export interface OutcomeOption {
  value: CallOutcome
  label: string
  hint: string
  tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral'
}

/** Matches `app.call_outcome` exactly — see database.types.ts. */
export const CALL_OUTCOMES: OutcomeOption[] = [
  { value: 'connected', label: 'Connected', hint: 'Spoke to them', tone: 'success' },
  { value: 'no_answer', label: 'No answer', hint: 'Rang out', tone: 'warning' },
  { value: 'busy', label: 'Busy', hint: 'Line engaged', tone: 'warning' },
  { value: 'switched_off', label: 'Switched off', hint: '', tone: 'warning' },
  { value: 'wrong_number', label: 'Wrong number', hint: 'Not this family', tone: 'danger' },
  { value: 'callback', label: 'Callback', hint: 'Asked to call later', tone: 'info' },
  { value: 'declined', label: 'Declined', hint: 'Refused to talk', tone: 'danger' },
  { value: 'other', label: 'Other', hint: 'Use notes below', tone: 'neutral' },
]

export function outcomeOption(value: CallOutcome | null | undefined): OutcomeOption | null {
  if (!value) return null
  return CALL_OUTCOMES.find((o) => o.value === value) ?? null
}

/**
 * Payload the completion form builds and either sends live or queues offline.
 * Deliberately flat and JSON-serialisable — this shape is written into
 * IndexedDB verbatim when offline.
 */
export interface CallCompletionPayload {
  attemptId: string
  eventId: string
  eventCode: string
  groupId: string
  outcome: CallOutcome
  notes: string | null
  callbackAt: string | null // ISO timestamp, only when outcome === 'callback'
  endedAt: string // ISO timestamp
  durationSec: number
}
