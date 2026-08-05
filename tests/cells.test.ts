/**
 * Cell cleaning — `src/lib/import/cells.ts`.
 *
 * Dates, times, travel modes and names. The rule under test throughout is the
 * one stated at the top of that module: a value that cannot be resolved with
 * certainty comes back null WITH a reason and the raw text preserved. Never an
 * invented date, never an invented time.
 */

import { describe, expect, it } from 'vitest'

import {
  buildDateWindow,
  cleanPersonName,
  parseEventDate,
  parseSheetTime,
  parseTravelMode,
} from '@/lib/import/cells'

/** 3–8 December 2026 — the same window the fixture is parsed against. */
const WINDOW = buildDateWindow('2026-12-03', '2026-12-08')

describe('buildDateWindow', () => {
  it('enumerates every day between starts_on and ends_on', () => {
    expect(WINDOW.source).toBe('event_dates')
    expect(WINDOW.dates).toEqual([
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
      '2026-12-07',
      '2026-12-08',
    ])
  })

  it('falls back to days 3–8 of the start month when ends_on is null', () => {
    // Both event dates are nullable in the schema, so this branch is real.
    const window = buildDateWindow('2026-12-20', null)
    expect(window.source).toBe('event_start_month')
    expect(window.dates).toEqual([
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
      '2026-12-06',
      '2026-12-07',
      '2026-12-08',
    ])
  })

  it('has no window at all when the event has no start date', () => {
    expect(buildDateWindow(null, null).source).toBe('none')
    expect(buildDateWindow(null, null).dates).toEqual([])
  })

  it('describes itself in words, so a warning can quote which rule was applied', () => {
    expect(WINDOW.description).toContain('3 Dec 2026')
    expect(WINDOW.description).toContain('8 Dec 2026')
  })
})

describe('parseEventDate — ordinals', () => {
  it('resolves "4TH " and "4th" to day 4 of the event', () => {
    for (const raw of ['4TH ', '4th', '4TH', ' 4th ', '4']) {
      expect(parseEventDate(raw, WINDOW)).toEqual({
        value: '2026-12-04',
        rawText: String(raw).trim(),
        reason: null,
      })
    }
  })

  it('warns and sets NO date for "9th", which is outside the event window', () => {
    const result = parseEventDate('9th', WINDOW)
    expect(result.value).toBeNull()
    // The raw text survives — the operator has to be able to see what the cell
    // said in order to fix it.
    expect(result.rawText).toBe('9th')
    expect(result.reason).toBeTruthy()
    expect(result.reason).toContain('9th')
    // The warning must name the window it was judged against, not just say no.
    expect(result.reason).toContain('3 Dec 2026')
  })

  it('resolves an ordinal against the EVENT month and year, not today', () => {
    // Today is not December 2026 and will never be again. A parser that
    // defaulted to `new Date()` would put this family in the wrong month.
    const december = parseEventDate('4TH', WINDOW).value
    expect(december).toBe('2026-12-04')

    // Same cell, a different event -> a different date. Nothing is hardcoded.
    const march = buildDateWindow('2027-03-03', '2027-03-08')
    expect(parseEventDate('4TH', march).value).toBe('2027-03-04')

    const thisYear = new Date().getUTCFullYear()
    expect(december?.slice(0, 4)).not.toBe(String(thisYear === 2026 ? 9999 : thisYear))
  })

  it('keeps the raw text when there is no window to resolve an ordinal against', () => {
    const none = buildDateWindow(null, null)
    const result = parseEventDate('4TH', none)
    expect(result.value).toBeNull()
    expect(result.rawText).toBe('4TH')
    expect(result.reason).toBeTruthy()
  })
})

describe('parseEventDate — other shapes the sheet contains', () => {
  it('disambiguates d/m vs m/d by testing both readings against the window', () => {
    // "4/12" is 4 December read the Indian way and 12 April read the American
    // way. Only one lands inside the event, so it resolves.
    expect(parseEventDate('4/12', WINDOW).value).toBe('2026-12-04')
  })

  it('keeps the raw text when neither reading lands inside the event', () => {
    const result = parseEventDate('5/6', WINDOW)
    expect(result.value).toBeNull()
    expect(result.rawText).toBe('5/6')
    expect(result.reason).toBeTruthy()
  })

  it('reads "6 Dec 2026" and "Dec 6 2026"', () => {
    expect(parseEventDate('6 Dec 2026', WINDOW).value).toBe('2026-12-06')
    expect(parseEventDate('Dec 6 2026', WINDOW).value).toBe('2026-12-06')
  })

  it('treats a blank cell as blank, with no warning', () => {
    expect(parseEventDate(null, WINDOW)).toEqual({ value: null, rawText: null, reason: null })
    expect(parseEventDate('   ', WINDOW)).toEqual({ value: null, rawText: null, reason: null })
  })
})

describe('parseSheetTime', () => {
  it('reads the Excel day fraction 0.4583 as 11:00, not 10:59', () => {
    // 0.4583 * 24 = 10.9992. Truncation gives an hour that never appeared in
    // the sheet, always one minute early, and it lands exactly on the round
    // hours that dominate this file.
    expect(parseSheetTime(0.4583)).toEqual({ value: '11:00', rawText: '0.4583', reason: null })
  })

  it('reads other day fractions', () => {
    expect(parseSheetTime(0.5).value).toBe('12:00')
    expect(parseSheetTime(0.25).value).toBe('06:00')
    expect(parseSheetTime(0.4375).value).toBe('10:30')
  })

  it('reads clock text', () => {
    expect(parseSheetTime('10:30').value).toBe('10:30')
    expect(parseSheetTime('18:30').value).toBe('18:30')
    expect(parseSheetTime('6.30 pm').value).toBe('18:30')
    expect(parseSheetTime('6 AM').value).toBe('06:00')
  })

  it('sets no time and explains itself when the cell is not a time', () => {
    const result = parseSheetTime('morning')
    expect(result.value).toBeNull()
    expect(result.rawText).toBe('morning')
    expect(result.reason).toBeTruthy()
  })

  it('treats a blank cell as blank, with no warning', () => {
    expect(parseSheetTime(null)).toEqual({ value: null, rawText: null, reason: null })
  })
})

describe('parseTravelMode', () => {
  it('maps "BY Road " to self_drive, casing and trailing space and all', () => {
    expect(parseTravelMode('BY Road ')).toEqual({
      value: 'self_drive',
      rawText: 'BY Road',
      reason: null,
    })
  })

  it('maps the other three phrasings this sheet uses', () => {
    expect(parseTravelMode('Flight').value).toBe('air')
    expect(parseTravelMode('Train').value).toBe('train')
    expect(parseTravelMode('Bus').value).toBe('bus')
    expect(parseTravelMode('Local Pick up').value).toBe('self_drive')
  })

  it('matches on word boundaries, so a place name is not a travel mode', () => {
    // "Ahmedabad" contains "bad", not "bus"; "repair" contains "air".
    expect(parseTravelMode('repair shop').value).toBeNull()
  })

  it('sets no mode rather than guessing when the cell is unrecognised', () => {
    const result = parseTravelMode('?')
    expect(result.value).toBeNull()
    expect(result.reason).toBeTruthy()
  })
})

describe('cleanPersonName', () => {
  it('strips a bracketed nickname and preserves the original casing', () => {
    expect(cleanPersonName('SUNITA (RITA) PATEL')).toEqual({
      value: 'SUNITA PATEL',
      removed: '(RITA)',
    })
  })

  it('records what it removed, so the change is visible in the preview', () => {
    expect(cleanPersonName('RAMESH (RAMU) PATEL').removed).toBe('(RAMU)')
  })

  it('leaves a name with no nickname exactly as it was', () => {
    expect(cleanPersonName('Kiran Shah')).toEqual({ value: 'Kiran Shah', removed: null })
  })

  it('never produces a nameless guest when the whole cell was bracketed', () => {
    expect(cleanPersonName('(unknown)').value).toBe('(unknown)')
  })

  it('treats a blank cell as no name', () => {
    expect(cleanPersonName('  ')).toEqual({ value: null, removed: null })
  })
})
