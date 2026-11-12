import type { SubSide } from '@/lib/import/normalize'
import type { Database } from '@/lib/supabase/database.types'

export type Side = Database['app']['Enums']['side']

const SIDE_OWNER: Record<'bride' | 'groom', string> = {
  groom: 'Groom',
  bride: 'Bride',
}

/**
 * Human-readable wedding side label including Father's / Mother's bifurcation.
 *
 * Examples:
 * - `('groom', 'father')` -> `"Groom's Father Side"`
 * - `('groom', 'mother')` -> `"Groom's Mother Side"`
 * - `('bride', 'father')` -> `"Bride's Father Side"`
 * - `('bride', 'mother')` -> `"Bride's Mother Side"`
 * - `('groom', null)`     -> `"Groom's side"`
 * - `('bride', null)`     -> `"Bride's side"`
 * - `('both', null)`      -> `"Both sides"`
 * - `('other', null)`     -> `"Other side"`
 */
export function formatSideLabel(
  side: Side | null | undefined,
  subSide?: SubSide | string | null,
): string | null {
  if (!side) return null
  if (side === 'both') return 'Both sides'
  if (side === 'other') return 'Other side'
  if (subSide === 'father') return `${SIDE_OWNER[side]}'s Father Side`
  if (subSide === 'mother') return `${SIDE_OWNER[side]}'s Mother Side`
  return `${SIDE_OWNER[side]}'s side`
}

export const SIDE_BRANCH_OPTIONS: Array<{
  key: string
  side: 'groom' | 'bride' | 'both' | 'other'
  subSide: SubSide | null
  label: string
}> = [
  { key: 'groom:father', side: 'groom', subSide: 'father', label: "Groom's Father Side" },
  { key: 'groom:mother', side: 'groom', subSide: 'mother', label: "Groom's Mother Side" },
  { key: 'groom', side: 'groom', subSide: null, label: "Groom's side (general)" },
  { key: 'bride:father', side: 'bride', subSide: 'father', label: "Bride's Father Side" },
  { key: 'bride:mother', side: 'bride', subSide: 'mother', label: "Bride's Mother Side" },
  { key: 'bride', side: 'bride', subSide: null, label: "Bride's side (general)" },
  { key: 'both', side: 'both', subSide: null, label: 'Both sides' },
  { key: 'other', side: 'other', subSide: null, label: 'Other side' },
]
