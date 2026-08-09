import { describe, expect, it } from 'vitest'

import {
  defaultDateAround,
  defaultDepartureDate,
  emptyFormValues,
  rsvpLogSchema,
  toDisplayCount,
} from '@/lib/rsvp-log'

describe('rsvpLogSchema', () => {
  it('requires a status', () => {
    const values = emptyFormValues()
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].path.join('.')).toBe('rsvpStatus')
  })

  it('accepts a terminal status with everything else empty', () => {
    const values = emptyFormValues()
    values.rsvpStatus = 'declined'
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(true)
  })

  it('rejects confirmed with no heads', () => {
    const values = emptyFormValues()
    values.rsvpStatus = 'confirmed'
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(false)
    if (result.success) return
    const adult = result.error.issues.find((i) => i.path.join('.') === 'adultsConfirmed')
    expect(adult).toBeDefined()
  })

  it('accepts confirmed with adults only', () => {
    const values = emptyFormValues()
    values.rsvpStatus = 'confirmed'
    values.adultsConfirmed = '4'
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(true)
  })

  it('rejects an arrival after departure', () => {
    const values = emptyFormValues()
    values.rsvpStatus = 'confirmed'
    values.adultsConfirmed = '2'
    values.arrival.date = '2026-12-25'
    values.departure.date = '2026-12-20'
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues.find((i) => i.path.join('.') === 'arrival.date')
    expect(issue).toBeDefined()
  })

  it('requires a callback time for callback status', () => {
    const values = emptyFormValues()
    values.rsvpStatus = 'callback'
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(false)
    if (result.success) return
    const issue = result.error.issues.find((i) => i.path.join('.') === 'callbackDatetime')
    expect(issue).toBeDefined()
  })

  it('accepts callback with a future time', () => {
    const values = emptyFormValues()
    values.rsvpStatus = 'callback'
    values.callbackDatetime = '2026-12-25T10:30'
    const result = rsvpLogSchema.safeParse(values)
    expect(result.success).toBe(true)
  })
})

describe('date defaults', () => {
  it('defaults arrival to the day before the event starts', () => {
    expect(defaultDateAround('2026-12-20', '2026-12-24')).toBe('2026-12-19')
  })

  it('defaults departure to the day after the event ends', () => {
    expect(defaultDepartureDate('2026-12-20', '2026-12-24')).toBe('2026-12-25')
  })

  it('handles a missing event window', () => {
    expect(defaultDateAround(null, null)).toBe('')
    expect(defaultDepartureDate(null, null)).toBe('')
  })
})

describe('toDisplayCount', () => {
  it('parses a count or falls back to 0', () => {
    expect(toDisplayCount('4')).toBe(4)
    expect(toDisplayCount('')).toBe(0)
    expect(toDisplayCount('abc')).toBe(0)
    expect(toDisplayCount('3.7')).toBe(0)
  })
})
