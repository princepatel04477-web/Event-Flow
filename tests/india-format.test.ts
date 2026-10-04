import { describe, expect, it } from 'vitest'

import {
  formatDate,
  formatDateTime,
  formatPax,
  formatPhone,
  formatRupees,
  formatTime,
} from '@/lib/format/india'

/**
 * The formats are pinned against fixed UTC instants, so the suite passes on a
 * machine in any timezone: every function formats in Asia/Kolkata regardless
 * of the runner's clock.
 */
describe('formatDate', () => {
  it('renders "20 Dec (Sun)" — day, month, weekday, in IST', () => {
    // 05:10 UTC is 10:40 IST on the 20th.
    expect(formatDate('2026-12-20T05:10:00Z')).toBe('20 Dec (Sun)')
  })

  it('does not slip a day backwards on a late-evening UTC instant', () => {
    // 19:00 UTC on the 20th is 00:30 IST on the 21st.
    expect(formatDate('2026-12-20T19:00:00Z')).toBe('21 Dec (Mon)')
  })

  it('is empty for a missing or unparseable value', () => {
    expect(formatDate(null)).toBe('')
    expect(formatDate('')).toBe('')
    expect(formatDate('not a date')).toBe('')
  })
})

describe('formatTime', () => {
  it('renders "10:30 AM" with a capital AM', () => {
    expect(formatTime('2026-12-20T05:00:00Z')).toBe('10:30 AM')
  })

  it('renders the afternoon with PM', () => {
    expect(formatTime('2026-12-20T08:45:00Z')).toBe('2:15 PM')
  })
})

describe('formatDateTime', () => {
  it('renders "20 Dec, 10:30 AM"', () => {
    expect(formatDateTime('2026-12-20T05:00:00Z')).toBe('20 Dec, 10:30 AM')
  })
})

describe('formatRupees', () => {
  it('uses Indian lakh grouping with no decimals', () => {
    expect(formatRupees(125000)).toBe('₹1,25,000')
    expect(formatRupees(999)).toBe('₹999')
  })

  it('is empty for a missing value', () => {
    expect(formatRupees(null)).toBe('')
  })
})

describe('formatPhone', () => {
  it('adds +91 and the 5+5 spacing to a bare ten digits', () => {
    expect(formatPhone('9876543210')).toBe('+91 98765 43210')
  })

  it('keeps the same output whatever the separators were', () => {
    expect(formatPhone('+91 98765-43210')).toBe('+91 98765 43210')
    expect(formatPhone('919876543210')).toBe('+91 98765 43210')
  })

  it('returns the input unchanged when it is not a ten-digit number', () => {
    expect(formatPhone('12345')).toBe('12345')
    expect(formatPhone('')).toBe('')
  })
})

describe('formatPax', () => {
  it('shows the slot when there is a total', () => {
    expect(formatPax(12, 15)).toBe('12/15 PAX')
  })

  it('shows a bare count when there is not', () => {
    expect(formatPax(12)).toBe('12 PAX')
  })
})
