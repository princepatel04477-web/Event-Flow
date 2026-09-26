/**
 * The four lockable sections and their labels, as a plain module.
 *
 * NOT in the `'use server'` action file: a `'use server'` module may only
 * export async functions, so the vocabulary lives here and both the admin
 * Settings screen and the staff banner import it.
 */

export type LockableSection = 'rsvp' | 'hospitality' | 'hamper' | 'logistics'

export const LOCKABLE_SECTIONS: readonly { id: LockableSection; label: string }[] = [
  { id: 'rsvp', label: 'RSVP / Calls' },
  { id: 'hospitality', label: 'Hospitality' },
  { id: 'hamper', label: 'Hampers' },
  { id: 'logistics', label: 'Logistics' },
]

export function isLockableSection(value: string): value is LockableSection {
  return LOCKABLE_SECTIONS.some((section) => section.id === value)
}
