import type { Database } from '@/lib/supabase/database.types'

export type RsvpStatus = Database['app']['Enums']['rsvp_status']
export type Side = Database['app']['Enums']['side']

export type QueueFilterState = {
  statuses: RsvpStatus[]
  side: Side | null
  /** `next_callback_at <= now()`. */
  callbackDue: boolean
  hideLocked: boolean
}

export const ALL_RSVP_STATUSES: RsvpStatus[] = [
  'not_started',
  'attempted',
  'callback',
  'tentative',
  'confirmed',
  'declined',
  'unreachable',
]

export const ALL_SIDES: Side[] = ['bride', 'groom', 'both', 'other']

export const DEFAULT_FILTERS: QueueFilterState = {
  statuses: [],
  side: null,
  callbackDue: false,
  hideLocked: false,
}

function isRsvpStatus(value: string): value is RsvpStatus {
  return (ALL_RSVP_STATUSES as string[]).includes(value)
}

function isSide(value: string): value is Side {
  return (ALL_SIDES as string[]).includes(value)
}

/**
 * Read filter state out of the URL. Keeping this pure (no hooks) lets both
 * the client board component and any future server-side reader share it.
 */
export function parseFilters(params: URLSearchParams): QueueFilterState {
  const statusParam = params.get('status')
  const statuses = statusParam
    ? statusParam.split(',').filter(isRsvpStatus)
    : []

  const sideParam = params.get('side')
  const side = sideParam && isSide(sideParam) ? sideParam : null

  return {
    statuses,
    side,
    callbackDue: params.get('callback') === 'due',
    hideLocked: params.get('hideLocked') === '1',
  }
}

/** Inverse of {@link parseFilters} — only writes keys that differ from the default. */
export function filtersToSearchParams(filters: QueueFilterState): URLSearchParams {
  const params = new URLSearchParams()

  if (filters.statuses.length > 0) params.set('status', filters.statuses.join(','))
  if (filters.side) params.set('side', filters.side)
  if (filters.callbackDue) params.set('callback', 'due')
  if (filters.hideLocked) params.set('hideLocked', '1')

  return params
}

export function hasActiveFilters(filters: QueueFilterState): boolean {
  return (
    filters.statuses.length > 0 ||
    filters.side !== null ||
    filters.callbackDue ||
    filters.hideLocked
  )
}
