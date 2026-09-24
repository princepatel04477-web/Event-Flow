import { describe, expect, it } from 'vitest'

import { invalidNumberMessage } from '../src/lib/review/invalid-number-copy'

describe('invalidNumberMessage', () => {
  it('names the field the reviewer typed into', () => {
    expect(invalidNumberMessage('Confirmed pax')).toBe('Confirmed guests must be a whole number.')
    expect(invalidNumberMessage('Arrival pax')).toBe('Arrival guests must be a whole number.')
    expect(invalidNumberMessage('Departure pax')).toBe('Departure guests must be a whole number.')
  })

  it('never shows the banned word to staff', () => {
    for (const label of ['Confirmed pax', 'Arrival pax', 'Departure pax']) {
      expect(invalidNumberMessage(label).toLowerCase()).not.toContain('pax')
    }
  })

  it('leaves a label that already says guests alone', () => {
    expect(invalidNumberMessage('Confirmed guests')).toBe('Confirmed guests must be a whole number.')
  })
})
