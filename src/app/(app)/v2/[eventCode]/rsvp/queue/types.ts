import type { CallOutcome, GuestGroupRow } from '@/lib/call/types'
import type { QueueFiltersKey } from '@/lib/query/keys'

export type QueueRow = {
  group_id: string | null
  head_name: string | null
  primary_mobile: string | null
  group_type: string | null
  side: string | null
  expected_pax: number | null
  confirmed_pax: number | null
  rsvp_status: string | null
  priority: number | null
  is_locked: boolean | null
  locked_by_staff: string | null
  locked_until: string | null
  attempt_count: number | null
  last_outcome: string | null
  next_callback_at: string | null
  remarks: string | null
}

export type FamilyRow = Pick<
  GuestGroupRow,
  | 'id'
  | 'head_name'
  | 'primary_mobile'
  | 'expected_pax'
  | 'confirmed_pax'
  | 'adults_confirmed'
  | 'children_confirmed'
  | 'needs_pickup'
  | 'special_requirements'
  | 'rsvp_status'
  | 'group_type'
  | 'side'
  | 'remarks'
>

export type Side = NonNullable<QueueFiltersKey['side']>

export type OutcomeStatus = 'confirmed' | 'declined' | 'unreachable' | 'callback' | 'tentative'

export interface Outcome {
  status: OutcomeStatus
  label: string
  callOutcome: CallOutcome
}

export type FilterChipId = 'to_call' | 'callback' | 'coming' | 'not_coming' | 'all'

export interface CallNextProps {
  eventId: string
  eventCode: string
  startsOn?: string | null
  endsOn?: string | null
  isAdmin?: boolean
}
