/**
 * Contacts-file path — `src/lib/import/contactsSheet.ts`.
 *
 * The pure, unit-testable surface: header resolution and the one-family-per-
 * row parse. The `File`-reading wrapper (`readContactsSheet`) is exercised
 * indirectly through the same shapes the import screen produces.
 *
 * The invariant under test throughout is the same one as the rest of the
 * import pipeline: a value that cannot be resolved with certainty comes back
 * null WITH a reason — never an invented name, never an invented number.
 */

import { describe, expect, it } from 'vitest'

import { parseContactsSheet, resolveContactsSheet } from '@/lib/import/contactsSheet'
import type { ContactsSheet } from '@/lib/import/contactsSheet'
import type { ParseFamiliesOptions } from '@/lib/import/families'

/** The event every test parses against, matching tests/helpers/sheet.ts. */
const EVENT: ParseFamiliesOptions = {
  eventStartsOn: '2026-12-03',
  eventEndsOn: '2026-12-08',
}

function sheetFor(headers: (string | null)[], rows: unknown[][]): ContactsSheet {
  // Derive the indexes through the production resolver, so a test can never
  // pass against a mapping the resolver would reject.
  const resolved = resolveContactsSheet(headers)
  if (!resolved.ok) throw new Error(`test headers did not resolve: ${resolved.reason}`)
  return {
    sheetName: 'Sheet1',
    headers,
    nameIndex: resolved.sheet.nameIndex,
    contactIndex: resolved.sheet.contactIndex,
    cityIndex: resolved.sheet.cityIndex,
    rows: rows.map((cells, i) => ({ sheetRowNumber: 2 + i, cells })),
  }
}

describe('resolveContactsSheet — header detection', () => {
  it('accepts a simple Name / Contact pair', () => {
    const result = resolveContactsSheet(['Name', 'Contact'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheet.nameIndex).toBe(0)
    expect(result.sheet.contactIndex).toBe(1)
    expect(result.sheet.cityIndex).toBeNull()
  })

  it('accepts common Contact spellings', () => {
    for (const header of ['Mobile', 'Phone', 'Mobile Number', 'Contact No', 'WhatsApp', 'Number']) {
      const result = resolveContactsSheet(['Name', header])
      expect(result.ok, `"${header}" should resolve`).toBe(true)
    }
  })

  it('accepts Name and Contact in either column order', () => {
    const result = resolveContactsSheet(['Contact Number', 'Guest Name'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheet.nameIndex).toBe(1)
    expect(result.sheet.contactIndex).toBe(0)
  })

  it('picks up a City column when present', () => {
    const result = resolveContactsSheet(['Name', 'Contact', 'City'])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sheet.cityIndex).toBe(2)
  })

  it('refuses when Name is missing', () => {
    const result = resolveContactsSheet(['Contact', 'City'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Name')
  })

  it('refuses when Contact is missing', () => {
    const result = resolveContactsSheet(['Name', 'City'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('Contact')
  })

  it('refuses when Name appears twice — a guess here means a wrong column', () => {
    // Two columns that EXACTLY match the Name alias, so the resolver cannot
    // tell which holds the guest name.
    const result = resolveContactsSheet(['Name', 'Contact', 'Name'])
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toContain('appears 2 times')
  })
})

describe('parseContactsSheet — one family per row', () => {
  it('turns each row into its own single-person family', () => {
    const sheet = sheetFor(
      ['Name', 'Contact'],
      [
        ['Sunita Patel', '9876543210'],
        ['Ramesh Shah', '9123456780'],
      ],
    )
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.result.families).toHaveLength(2)
    expect(outcome.result.counts.families).toBe(2)
    expect(outcome.result.counts.members).toBe(2)
    expect(outcome.result.counts.orphans).toBe(0)

    const [first, second] = outcome.result.families
    expect(first.headName).toBe('Sunita Patel')
    expect(first.primaryMobile).toBe('9876543210')
    expect(first.familyNumber).toBe('1')
    expect(second.headName).toBe('Ramesh Shah')
    expect(second.familyNumber).toBe('2')

    // One person per family, no travel legs.
    expect(first.members).toHaveLength(1)
    expect(first.members[0].isHead).toBe(true)
    expect(first.expectedPax).toBe(1)
    expect(first.arrival.hasAnyValue).toBe(false)
    expect(first.departure.hasAnyValue).toBe(false)
  })

  it('normalises a mobile that arrives as a float (Excel)', () => {
    const sheet = sheetFor(['Name', 'Contact'], [['A', 9876543210]])
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.families[0].primaryMobile).toBe('9876543210')
  })

  it('warns — never guesses — when a number cannot be read', () => {
    const sheet = sheetFor(['Name', 'Contact'], [['A', 'not-a-number']])
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const family = outcome.result.families[0]
    expect(family.primaryMobile).toBeNull()
    expect(family.warnings.some((w) => w.code === 'mobile_unreadable')).toBe(true)
  })

  it('warns on a missing number', () => {
    const sheet = sheetFor(['Name', 'Contact'], [['A', null]])
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.result.families[0].primaryMobile).toBeNull()
    expect(outcome.result.families[0].warnings.some((w) => w.code === 'mobile_missing')).toBe(true)
  })

  it('blocks — and warns — a row with no name', () => {
    const sheet = sheetFor(['Name', 'Contact'], [[null, '9876543210']])
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const family = outcome.result.families[0]
    expect(family.canImport).toBe(false)
    expect(family.warnings.some((w) => w.code === 'head_name_missing')).toBe(true)
    expect(outcome.result.counts.blockedFamilies).toBe(1)
  })

  it('keeps a City column onto the family place', () => {
    const sheet: ContactsSheet = {
      sheetName: 'Sheet1',
      headers: ['Name', 'Contact', 'City'],
      nameIndex: 0,
      contactIndex: 1,
      cityIndex: 2,
      rows: [{ sheetRowNumber: 2, cells: ['A', '9876543210', 'Ahmedabad'] }],
    }
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.families[0].place).toBe('Ahmedabad')
  })

  it('fails cleanly on a header with no rows beneath it', () => {
    const sheet = sheetFor(['Name', 'Contact'], [])
    const outcome = parseContactsSheet(sheet, EVENT)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('no rows')
  })
})
