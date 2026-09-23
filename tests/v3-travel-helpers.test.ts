import { describe, expect, it } from 'vitest'

import {
  displayName,
  doneCount,
  groupBySlot,
  isCodeMode,
  isDone,
  modeLabel,
  nowContext,
  nowHeadline,
  paxCount,
  paxLabel,
  placeLabel,
  progressLabel,
  remainingRows,
  rowMeta,
  shortTime,
  slotHeading,
  slotKey,
  statusLabel,
  type TravelRow,
} from '@/app/(app)/v2/[eventCode]/logistics/_components/_travel'

/**
 * The Travel board's pure view helpers (SPEC-V3 §4).
 *
 * WHY THIS FILE EXISTS. The board itself is a client component with a Supabase
 * read in it, so nothing in this suite can render it — and this session's
 * sandbox cannot launch a browser to look at it either. What CAN be asserted is
 * the part of the board that decides what a runner reads: which time slot a row
 * belongs to, what the status word is, how many people are travelling. Every one
 * of those is a rule that has already been got wrong somewhere in this repo
 * (a "0 guests" row for a family nobody counted, a group per untimed row, mono
 * on a cab's vendor name), so they are pinned here rather than eyeballed.
 *
 * `environment: 'node'`, no renderer, no DB — the module under test is pure and
 * dependency-free by design.
 */

function leg(over: Partial<TravelRow['leg']> = {}): TravelRow['leg'] {
  return {
    id: 'leg-1',
    group_id: 'grp-1',
    mode: 'air',
    travel_date: '2026-12-20',
    travel_time: '10:30:00',
    reference: '6E 5074',
    point: 'Ahmedabad T2',
    pax_on_leg: 6,
    arrived_at: null,
    departed_at: null,
    ...over,
  }
}

function group(over: Partial<TravelRow['group']> = {}): TravelRow['group'] {
  return {
    id: 'grp-1',
    head_name: 'Ravi Kumar',
    primary_mobile: '+919876543210',
    expected_pax: 6,
    adults_confirmed: null,
    children_confirmed: null,
    needs_pickup: true,
    ...over,
  }
}

function row(over: Partial<TravelRow> = {}): TravelRow {
  return { leg: leg(), group: group(), roomLabel: 'Grand 104', ...over }
}

const today = '2026-12-20'
const dayLabel = (d: string) => `day(${d})`

describe('slotKey / slotHeading', () => {
  it('collapses every untimed row on a day into ONE slot', () => {
    const a = leg({ id: 'a', travel_time: null })
    const b = leg({ id: 'b', travel_time: null })
    expect(slotKey(a)).toBe(slotKey(b))
    expect(slotKey(a)).toBe('2026-12-20|')
  })

  it('separates two rows at different times', () => {
    expect(slotKey(leg({ travel_time: '10:30:00' }))).not.toBe(
      slotKey(leg({ travel_time: '11:00:00' })),
    )
  })

  it('says Today for today and the caller label otherwise', () => {
    expect(slotHeading(leg(), today, dayLabel)).toBe('Today · 10:30')
    expect(slotHeading(leg({ travel_date: '2026-12-21' }), today, dayLabel)).toBe(
      'day(2026-12-21) · 10:30',
    )
  })

  it('never renders an empty heading when the data is thin', () => {
    expect(slotHeading(leg({ travel_date: null, travel_time: null }), today, dayLabel)).toBe(
      'Date not set',
    )
    expect(slotHeading(leg({ travel_date: null, travel_time: '08:00:00' }), today, dayLabel)).toBe(
      'No date · 08:00',
    )
    expect(slotHeading(leg({ travel_time: null }), today, dayLabel)).toBe('Today')
  })

  it('trims seconds off a Postgres time', () => {
    expect(shortTime('10:30:00')).toBe('10:30')
    expect(shortTime('10:30')).toBe('10:30')
    expect(shortTime(null)).toBeNull()
  })
})

describe('groupBySlot', () => {
  it('groups CONSECUTIVE rows and keeps the read order', () => {
    const rows = [
      row({ leg: leg({ id: '1', travel_time: '10:30:00' }) }),
      row({ leg: leg({ id: '2', travel_time: '10:30:00' }) }),
      row({ leg: leg({ id: '3', travel_time: '11:00:00' }) }),
    ]
    const groups = groupBySlot(rows)
    expect(groups.map((g) => g.rows.length)).toEqual([2, 1])
    expect(groups.map((g) => g.key)).toEqual(['2026-12-20|10:30:00', '2026-12-20|11:00:00'])
  })

  it('does not merge the same time on two different days', () => {
    const rows = [
      row({ leg: leg({ id: '1', travel_date: '2026-12-20' }) }),
      row({ leg: leg({ id: '2', travel_date: '2026-12-21' }) }),
    ]
    expect(groupBySlot(rows).length).toBe(2)
  })

  it('groups untimed rows on one day together even when they are not adjacent', () => {
    // A run-based grouping, so a timed row between two untimed ones splits them.
    // That is the honest behaviour: the read ordered the rows and this must not
    // re-order them. Asserted so the split is a decision, not a surprise.
    const rows = [
      row({ leg: leg({ id: '1', travel_time: null }) }),
      row({ leg: leg({ id: '2', travel_time: '09:00:00' }) }),
      row({ leg: leg({ id: '3', travel_time: null }) }),
    ]
    expect(groupBySlot(rows).map((g) => g.rows.length)).toEqual([1, 1, 1])
  })

  it('returns nothing for nothing', () => {
    expect(groupBySlot([])).toEqual([])
  })
})

describe('pax', () => {
  it('prefers the confirmed split over the RSVP estimate', () => {
    expect(paxCount(row({ group: group({ adults_confirmed: 4, children_confirmed: 2 }) }))).toBe(6)
  })

  it('falls back to expected_pax, then to the leg', () => {
    expect(paxCount(row({ group: group({ expected_pax: 5 }) }))).toBe(5)
    expect(
      paxCount(row({ group: group({ expected_pax: 0 }), leg: leg({ pax_on_leg: 3 }) })),
    ).toBe(3)
  })

  it('reports 0 rather than guessing, and the label says nothing rather than "0 guests"', () => {
    const none = row({ group: group({ expected_pax: 0 }), leg: leg({ pax_on_leg: null }) })
    expect(paxCount(none)).toBe(0)
    expect(paxLabel(0)).toBeNull()
    expect(paxLabel(1)).toBe('1 guest')
    expect(paxLabel(2)).toBe('2 guests')
  })
})

describe('status', () => {
  it('reads the column that matches the direction', () => {
    const arrived = row({ leg: leg({ arrived_at: '2026-12-20T10:40:00Z' }) })
    expect(isDone(arrived, 'arrival')).toBe(true)
    // The same row is NOT done as a departure — the two timestamps are
    // independent columns and conflating them would mark a family gone.
    expect(isDone(arrived, 'departure')).toBe(false)
  })

  it('uses a different word per direction', () => {
    expect(statusLabel(row(), 'arrival')).toBe('Expected')
    expect(statusLabel(row(), 'departure')).toBe('To go')
    expect(statusLabel(row({ leg: leg({ arrived_at: 'x' }) }), 'arrival')).toBe('Met')
    expect(statusLabel(row({ leg: leg({ departed_at: 'x' }) }), 'departure')).toBe('Gone')
  })

  it('counts and filters what is left', () => {
    const rows = [
      row({ leg: leg({ id: '1', arrived_at: 'x' }) }),
      row({ leg: leg({ id: '2' }) }),
      row({ leg: leg({ id: '3' }) }),
    ]
    expect(doneCount(rows, 'arrival')).toBe(1)
    expect(remainingRows(rows, 'arrival').map((r) => r.leg.id)).toEqual(['2', '3'])
  })

  it('names the progress bar after the direction', () => {
    expect(progressLabel('arrival')).toBe('Arrivals met')
    expect(progressLabel('departure')).toBe('Departures gone')
  })
})

describe('names, modes and places', () => {
  it('uses the head name, then the mobile, then a plain fallback', () => {
    expect(displayName(row(), () => 'fmt')).toBe('Ravi Kumar')
    expect(displayName(row({ group: group({ head_name: '  ' }) }), (m) => `fmt:${m}`)).toBe(
      'fmt:+919876543210',
    )
    expect(displayName(row({ group: group({ head_name: null, primary_mobile: null }) }))).toBe(
      'Unnamed family',
    )
  })

  it('labels the enum and passes an unknown value through', () => {
    expect(modeLabel('self_drive')).toBe('Self-drive')
    expect(modeLabel('helicopter')).toBe('helicopter')
    expect(modeLabel(null)).toBeNull()
  })

  it('sets only a flight or a train number in mono', () => {
    expect(isCodeMode('air')).toBe(true)
    expect(isCodeMode('train')).toBe(true)
    expect(isCodeMode('cab')).toBe(false)
    expect(isCodeMode(null)).toBe(false)
  })

  it('says "no room" honestly, and never "Room "', () => {
    expect(placeLabel('Grand 104')).toBe('Room Grand 104')
    expect(placeLabel('   ')).toBeNull()
  })
})

describe('the lines a runner reads', () => {
  it('puts the departure time first, because that is the question', () => {
    expect(rowMeta(row(), 'departure', { todayKey: today, dayLabel })).toBe(
      'Today · 10:30 · Air · 6E 5074 · 6 guests · Room Grand 104',
    )
  })

  it('leaves the time off an arrival row — the slot heading above it says it', () => {
    expect(rowMeta(row(), 'arrival', { todayKey: today, dayLabel })).toBe(
      'Air · 6E 5074 · 6 guests · Room Grand 104',
    )
  })

  it('says "No room yet" on an arrival and "No room" on a departure', () => {
    expect(rowMeta(row({ roomLabel: '' }), 'arrival', { todayKey: today, dayLabel })).toContain(
      'No room yet',
    )
    expect(rowMeta(row({ roomLabel: '' }), 'departure', { todayKey: today, dayLabel })).toContain(
      'No room',
    )
  })

  it('never emits an empty segment', () => {
    // EVERY count at zero, not just the group's: `paxCount` falls back to
    // `pax_on_leg`, so leaving the leg's own 6 in place would have made this
    // row read "6 guests" and the assertion below pass for the wrong reason.
    const bare = row({
      leg: leg({ mode: null, reference: null, travel_time: null, pax_on_leg: 0 }),
      group: group({ expected_pax: 0 }),
      roomLabel: '',
    })
    expect(paxCount(bare)).toBe(0)
    expect(rowMeta(bare, 'arrival', { todayKey: today, dayLabel })).toBe('No room yet')
  })

  it('headlines the arrival clock and falls back rather than guessing', () => {
    expect(nowHeadline(row(), { todayKey: today, dayLabel })).toBe('10:30')
    expect(nowHeadline(row({ leg: leg({ travel_time: null }) }), { todayKey: today, dayLabel })).toBe(
      'Today',
    )
    expect(
      nowHeadline(row({ leg: leg({ travel_time: null, travel_date: '2026-12-22' }) }), {
        todayKey: today,
        dayLabel,
      }),
    ).toBe('day(2026-12-22)')
    expect(
      nowHeadline(row({ leg: leg({ travel_time: null, travel_date: null }) }), {
        todayKey: today,
        dayLabel,
      }),
    ).toBe('No time set')
  })

  it('builds the Now context from who, how many, when and where', () => {
    expect(nowContext(row(), 'arrival', { todayKey: today, dayLabel })).toBe(
      'Ravi Kumar · 6 guests · Today · 10:30 · Room Grand 104',
    )
    expect(nowContext(row({ roomLabel: '' }), 'departure', { todayKey: today, dayLabel })).toBe(
      'Ravi Kumar · 6 guests · Today · 10:30 · no room yet',
    )
  })
})
