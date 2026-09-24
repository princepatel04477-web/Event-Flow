import { describe, expect, it } from 'vitest'

import {
  groupTypeLabel,
  sideLabel,
} from '@/app/(staff)/[eventCode]/guests/_components/format'

/**
 * m8 — the room-allocation screen printed the raw enum values (`bride`,
 * `groom`, `family`, `couple`, `friends`) on a staff screen. It now goes
 * through the app's one side / group-type label map, so these assertions pin
 * the words that map produces — a raw enum leaking back in fails here.
 */
describe('sideLabel', () => {
  it('turns every recorded side into words, never the raw enum', () => {
    expect(sideLabel('bride')).toBe("Bride's side")
    expect(sideLabel('groom')).toBe("Groom's side")
    expect(sideLabel('both')).toBe('Both sides')
    expect(sideLabel('other')).toBe('Other side')
  })

  it('renders nothing for an unrecorded side', () => {
    expect(sideLabel(null)).toBeNull()
  })
})

describe('groupTypeLabel', () => {
  it('turns every group type into a word, never the raw enum', () => {
    expect(groupTypeLabel('family')).toBe('Family')
    expect(groupTypeLabel('couple')).toBe('Couple')
    expect(groupTypeLabel('friends')).toBe('Friends')
    expect(groupTypeLabel('single')).toBe('Single')
  })

  it('renders nothing for an unrecorded group type', () => {
    expect(groupTypeLabel(null)).toBeNull()
  })
})
