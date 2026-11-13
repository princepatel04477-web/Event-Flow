export type CallKind = 'first' | 'reminder'

/**
 * Determines whether a call should default to a 'first' intake call or a 'reminder' call.
 * Returns 'reminder' when rsvpStatus is 'confirmed', 'declined', or 'tentative'.
 * Otherwise returns 'first'.
 */
export function defaultCallKind(rsvpStatus: string | null | undefined): CallKind {
  if (rsvpStatus === 'confirmed' || rsvpStatus === 'declined' || rsvpStatus === 'tentative') {
    return 'reminder'
  }
  return 'first'
}

export const CALL_KIND_OPTIONS = [
  { value: 'first', label: 'First call · records details' },
  { value: 'reminder', label: 'Reminder · not recorded' },
] as const satisfies readonly { value: CallKind; label: string }[]
