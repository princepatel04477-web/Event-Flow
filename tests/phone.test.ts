/**
 * Mobile normalisation — `src/lib/phone.ts`.
 *
 * This is the single implementation shared by the importer and the call
 * screen. Its governing property is not "parses lots of formats"; it is
 * REJECTS RATHER THAN TRUNCATES. A blank number costs a caller one lookup. A
 * plausible-but-wrong 10-digit number gets a stranger dialled at 9pm and an
 * RSVP logged against the wrong family, and nobody finds out until the wrong
 * family does not arrive.
 */

import { describe, expect, it } from 'vitest'

import { normaliseMobile, normalisedMobile } from '@/lib/phone'

const CANONICAL = '9425155093'

describe('normaliseMobile — the four shapes this sheet actually contains', () => {
  it('reads a phone stored as a float in scientific notation: 9.425155093E9', () => {
    // Excel renders a numeric mobile cell this way when the column is narrow.
    // The mantissa carries all ten digits, so nothing was lost.
    expect(normaliseMobile(9.425155093e9)).toEqual({ value: CANONICAL, reason: null })
    expect(normaliseMobile('9.425155093E9')).toEqual({ value: CANONICAL, reason: null })
  })

  it('strips a "+91 " country code and the spaces around it', () => {
    expect(normaliseMobile('+91 94251 55093')).toEqual({ value: CANONICAL, reason: null })
  })

  it('strips a leading trunk zero', () => {
    expect(normaliseMobile('094251 55093')).toEqual({ value: CANONICAL, reason: null })
  })

  it('strips the trailing ".0" Excel leaves on a numeric cell exported as text', () => {
    expect(normalisedMobile('9425155093.0')).toBe(CANONICAL)
  })

  it('reads a plain numeric cell', () => {
    expect(normalisedMobile(9876543210)).toBe('9876543210')
  })
})

describe('normaliseMobile — anything it cannot read comes back BLANK, never truncated', () => {
  /**
   * Each of these could be turned into ten digits by something that guesses.
   * None of them may be.
   */
  const unreadable: Array<[label: string, input: unknown]> = [
    // A country code that is not +91. Slicing the last 10 digits gives
    // "4155550132" — a real, dialable, completely unrelated Indian mobile.
    ['a US number', '+1 415 555 0132'],
    ['a UK number', '+44 20 7946 0958'],
    // Excel threw four digits away when it rendered this cell. Number() would
    // happily return 9425160000, which is also a real Indian mobile.
    ['a lossy exponential rendering', '9.42516E+09'],
    ['two numbers in one cell', '9876543210 / 9876543211'],
    ['a landline with an STD code and an extension', '079-2630-1234 ext 12'],
    ['too few digits', '94251'],
    ['a note instead of a number', 'ask his son'],
    ['a number beyond double precision', 9.4251550931234568e24],
  ]

  it.each(unreadable)('rejects %s', (_label, input) => {
    const result = normaliseMobile(input)
    expect(result.value).toBeNull()
    // A rejection must be explainable — the preview shows this to the operator.
    expect(result.reason).toBeTruthy()
  })

  it('specifically never truncates a non-+91 number to its last 10 digits', () => {
    // The exact bug this module was rewritten to kill.
    expect(normalisedMobile('+1 415 555 0132')).not.toBe('4155550132')
    expect(normalisedMobile('+1 415 555 0132')).toBeNull()
  })

  it('treats a blank cell as blank rather than as an error', () => {
    for (const blank of [null, undefined, '', '   ']) {
      expect(normaliseMobile(blank)).toEqual({ value: null, reason: null })
    }
  })
})
