import { describe, expect, it } from 'vitest'

import {
  FILTER_CHIPS,
  OUTCOME_DEFINITIONS,
  filterCounts,
  filterRows,
  matchesFilter,
  outcomeDefinition,
  type FilterableRow,
} from '@/lib/rsvp-queue'

function row(rsvp_status: string | null, next_callback_at: string | null = null): FilterableRow {
  return { rsvp_status, next_callback_at }
}

/**
 * One row per state the queue can hold, plus the ambiguous pair:
 *   * `attempted` is a family that was dialled and never picked up - it is
 *     still work to do AND still unreached, so it sits under two chips.
 *   * `confirmed` with a callback time is an answered family that also asked
 *     to be rung again, so it sits under Coming and Call back.
 */
const ROWS: FilterableRow[] = [
  row(null),
  row('not_started'),
  row('attempted'),
  row('confirmed'),
  row('tentative'),
  row('declined'),
  row('unreachable'),
  row('callback'),
  row('confirmed', '2026-12-20T10:00:00.000Z'),
]

describe('queue chips', () => {
  it('offers every chip the Calls screen needs, in funnel order', () => {
    expect(FILTER_CHIPS.map((chip) => chip.id)).toEqual([
      'to_call',
      'coming',
      'not_coming',
      'no_answer',
      'callback',
      'all',
    ])
  })

  it('labels every chip', () => {
    for (const chip of FILTER_CHIPS) expect(chip.label.length).toBeGreaterThan(0)
  })
})
describe('matchesFilter', () => {
  it('To call is the untouched work: null, not_started and attempted', () => {
    expect(matchesFilter('to_call', row(null))).toBe(true)
    expect(matchesFilter('to_call', row('not_started'))).toBe(true)
    expect(matchesFilter('to_call', row('attempted'))).toBe(true)
    expect(matchesFilter('to_call', row('confirmed'))).toBe(false)
    expect(matchesFilter('to_call', row('declined'))).toBe(false)
    expect(matchesFilter('to_call', row('unreachable'))).toBe(false)
  })

  it('Coming is confirmed and tentative, nothing else', () => {
    expect(matchesFilter('coming', row('confirmed'))).toBe(true)
    expect(matchesFilter('coming', row('tentative'))).toBe(true)
    expect(matchesFilter('coming', row('attempted'))).toBe(false)
    expect(matchesFilter('coming', row('declined'))).toBe(false)
  })

  it('Not coming is declined ONLY - unreachable belongs to No answer', () => {
    expect(matchesFilter('not_coming', row('declined'))).toBe(true)
    expect(matchesFilter('not_coming', row('unreachable'))).toBe(false)
  })

  it('No answer is unreachable and attempted', () => {
    expect(matchesFilter('no_answer', row('unreachable'))).toBe(true)
    expect(matchesFilter('no_answer', row('attempted'))).toBe(true)
    expect(matchesFilter('no_answer', row('declined'))).toBe(false)
  })

  it('Call back is the status OR a scheduled callback time', () => {
    expect(matchesFilter('callback', row('callback'))).toBe(true)
    expect(matchesFilter('callback', row('confirmed', '2026-12-20T10:00:00.000Z'))).toBe(true)
    expect(matchesFilter('callback', row('confirmed'))).toBe(false)
  })

  it('All keeps every row', () => {
    expect(matchesFilter('all', row(null))).toBe(true)
    expect(matchesFilter('all', row('declined'))).toBe(true)
  })
})
describe('filterRows', () => {
  it('selects exactly the rows its chip promises', () => {
    expect(filterRows(ROWS, 'to_call')).toHaveLength(3)
    expect(filterRows(ROWS, 'coming')).toHaveLength(3)
    expect(filterRows(ROWS, 'not_coming')).toHaveLength(1)
    expect(filterRows(ROWS, 'no_answer')).toHaveLength(2)
    expect(filterRows(ROWS, 'callback')).toHaveLength(2)
    expect(filterRows(ROWS, 'all')).toHaveLength(ROWS.length)
  })

  it('keeps the view order inside a chip', () => {
    const names = filterRows(ROWS, 'coming').map((r) => r.rsvp_status)
    expect(names).toEqual(['confirmed', 'tentative', 'confirmed'])
  })
})

describe('filterCounts', () => {
  it('numbers every chip, over the whole list', () => {
    expect(filterCounts(ROWS)).toEqual({
      to_call: 3,
      coming: 3,
      not_coming: 1,
      no_answer: 2,
      callback: 2,
      all: 9,
    })
  })

  it('counts an empty list as all zeroes rather than undefined', () => {
    expect(filterCounts([])).toEqual({
      to_call: 0,
      coming: 0,
      not_coming: 0,
      no_answer: 0,
      callback: 0,
      all: 0,
    })
  })

  it('does not assume the chips partition the list', () => {
    const counts = filterCounts(ROWS)
    const sum = counts.to_call + counts.coming + counts.not_coming + counts.no_answer + counts.callback
    expect(sum).toBeGreaterThan(counts.all)
  })
})
describe('outcome -> status', () => {
  it('writes a definite status for each of the five outcomes', () => {
    expect(outcomeDefinition('coming').status).toBe('confirmed')
    expect(outcomeDefinition('not_coming').status).toBe('declined')
    expect(outcomeDefinition('no_answer').status).toBe('unreachable')
    expect(outcomeDefinition('maybe').status).toBe('tentative')
    expect(outcomeDefinition('callback').status).toBe('callback')
  })

  it('never saves a call that leaves the family on not_started', () => {
    for (const definition of Object.values(OUTCOME_DEFINITIONS)) {
      expect(definition.status).not.toBe('not_started')
      expect(definition.status).not.toBe('attempted')
    }
  })

  it('pairs each status with the call_outcome the enum accepts', () => {
    expect(outcomeDefinition('coming').callOutcome).toBe('connected')
    expect(outcomeDefinition('not_coming').callOutcome).toBe('declined')
    expect(outcomeDefinition('no_answer').callOutcome).toBe('no_answer')
    expect(outcomeDefinition('maybe').callOutcome).toBe('connected')
    expect(outcomeDefinition('callback').callOutcome).toBe('callback')
  })
})
describe('outcome and chip agree', () => {
  it('lands every outcome under the chip that then shows it', () => {
    for (const [key, definition] of Object.entries(OUTCOME_DEFINITIONS)) {
      expect(matchesFilter(definition.chip, row(definition.status)), key).toBe(true)
    }
  })

  it('moves a family OUT of To call the moment an outcome is saved', () => {
    for (const definition of Object.values(OUTCOME_DEFINITIONS)) {
      expect(matchesFilter('to_call', row(definition.status))).toBe(false)
    }
  })

  it('labels every outcome for the Undo bar', () => {
    for (const definition of Object.values(OUTCOME_DEFINITIONS)) {
      expect(definition.label.length).toBeGreaterThan(0)
    }
  })
})