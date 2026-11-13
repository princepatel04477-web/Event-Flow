import { describe, expect, it } from 'vitest'

import { CALL_KIND_OPTIONS, defaultCallKind } from '@/lib/call-kind'

describe('defaultCallKind', () => {
  it('returns "first" for initial and unreached statuses', () => {
    expect(defaultCallKind('not_started')).toBe('first')
    expect(defaultCallKind('attempted')).toBe('first')
    expect(defaultCallKind('callback')).toBe('first')
    expect(defaultCallKind('unreachable')).toBe('first')
  })

  it('returns "reminder" for confirmed, declined, or tentative statuses', () => {
    expect(defaultCallKind('tentative')).toBe('reminder')
    expect(defaultCallKind('confirmed')).toBe('reminder')
    expect(defaultCallKind('declined')).toBe('reminder')
  })

  it('handles null, undefined, and unrecognized statuses safely as "first"', () => {
    expect(defaultCallKind(null)).toBe('first')
    expect(defaultCallKind(undefined)).toBe('first')
    expect(defaultCallKind('')).toBe('first')
    expect(defaultCallKind('something_else')).toBe('first')
  })

  it('exports two-option call kind choices matching expected copy', () => {
    expect(CALL_KIND_OPTIONS).toHaveLength(2)
    expect(CALL_KIND_OPTIONS[0]).toEqual({
      value: 'first',
      label: 'First call · records details',
    })
    expect(CALL_KIND_OPTIONS[1]).toEqual({
      value: 'reminder',
      label: 'Reminder · not recorded',
    })
  })
})
