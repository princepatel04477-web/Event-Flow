import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { buildSheetDefinitions } from '@/lib/export/definitions'
import { buildWorkbook } from '@/lib/export/workbook'
import type { ExportData, GuestExportRow } from '@/lib/export/sheets'

/**
 * F1 — "In exporting pax why it is one Qty only".
 *
 * Fixture: three families with 4, 2 and 1 guests. The first family is split
 * into four guest rows (four people, one of them the head) so the one-row-per-
 * guest sheet is exercised. Every sheet's PAX column must total 7 — the true
 * headcount — whether it is one row per family (Guest Master, Arrivals,
 * Departures) or one row per guest (Room Allocation, where PAX rides on the
 * head's row only so a plain Excel SUM is correct).
 */

const EVENT = 'e1'

interface GroupSpec {
  id: string
  code: string
  head: string
  pax: number
  confirmed: number | null
}

function group(spec: GroupSpec) {
  return {
    id: spec.id,
    event_id: EVENT,
    group_code: spec.code,
    head_name: spec.head,
    primary_mobile: '9000000000',
    alt_mobile: null,
    side: 'bride' as const,
    group_type: 'family' as const,
    city: 'Ahmedabad',
    expected_pax: spec.pax,
    confirmed_pax: spec.confirmed,
    adults_confirmed: null,
    children_confirmed: null,
    expected_adults: null,
    expected_children: null,
    rsvp_status: 'not_started' as const,
    needs_return_gift: false,
    priority: 0,
    remarks: null,
    locked_by: null,
    locked_by_staff: null,
    locked_until: null,
    last_opened_by_staff: null,
    last_opened_at: null,
    source_row_hash: null,
    needs_pickup: false,
    special_requirements: [],
    callback_at: null,
    call_count: 0,
    created_at: '2026-08-01T00:00:00Z',
    created_by: null,
    created_by_staff: null,
    updated_at: '2026-08-01T00:00:00Z',
  }
}

function assignment(id: string, groupId: string, guestId: string, roomId: string) {
  return {
    id,
    event_id: EVENT,
    group_id: groupId,
    guest_id: guestId,
    room_id: roomId,
    assigned_at: '2026-08-01T00:00:00Z',
    assigned_by: null,
    assigned_by_staff: null,
    check_in_date: '2026-12-19',
    check_in_time: '10:30:00',
    check_out_date: null,
    check_out_time: null,
    checked_in_at: null,
    checked_out_at: null,
    released_at: null,
    release_reason: null,
    is_override: false,
    override_reason: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
}

function leg(id: string, groupId: string, direction: 'arrival' | 'departure') {
  return {
    id,
    event_id: EVENT,
    group_id: groupId,
    direction,
    mode: 'train' as const,
    travel_date: '2026-12-19',
    travel_time: '10:30:00',
    reference: '19004',
    point: 'Vadodara',
    needs_transport: true,
    pax_on_leg: null,
    arrived_at: null,
    departed_at: null,
    source: 'rsvp_call' as const,
    notes: null,
    created_by: null,
    created_by_staff: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
}

function makeData(): ExportData {
  const groups = [
    group({ id: 'g1', code: '1', head: 'Four Family', pax: 4, confirmed: null }),
    group({ id: 'g2', code: '2', head: 'Two Family', pax: 2, confirmed: null }),
    group({ id: 'g3', code: '3', head: 'One Family', pax: 1, confirmed: null }),
  ]

  // Family 1 split into four guest rows; families 2 and 3 one each.
  const guests: GuestExportRow[] = [
    { id: 'g1-1', group_id: 'g1', full_name: 'Four A', is_head: true },
    { id: 'g1-2', group_id: 'g1', full_name: 'Four B', is_head: false },
    { id: 'g1-3', group_id: 'g1', full_name: 'Four C', is_head: false },
    { id: 'g1-4', group_id: 'g1', full_name: 'Four D', is_head: false },
    { id: 'g2-1', group_id: 'g2', full_name: 'Two A', is_head: true },
    { id: 'g3-1', group_id: 'g3', full_name: 'One A', is_head: true },
  ]

  return {
    groups,
    guests,
    legs: [
      leg('leg-1a', 'g1', 'arrival'), leg('leg-1d', 'g1', 'departure'),
      leg('leg-2a', 'g2', 'arrival'), leg('leg-2d', 'g2', 'departure'),
      leg('leg-3a', 'g3', 'arrival'), leg('leg-3d', 'g3', 'departure'),
    ],
    deliverables: [],
    proofs: [],
    assignments: [
      assignment('a1', 'g1', 'g1-1', 'r1'),
      assignment('a2', 'g1', 'g1-2', 'r1'),
      assignment('a3', 'g1', 'g1-3', 'r2'),
      assignment('a4', 'g1', 'g1-4', 'r2'),
      assignment('a5', 'g2', 'g2-1', 'r3'),
      assignment('a6', 'g3', 'g3-1', 'r4'),
    ],
    rooms: [
      { id: 'r1', event_id: EVENT, hotel_id: 'h1', room_number: '101', room_type: 'Deluxe', floor: null, capacity: 2, max_capacity: 3, is_blocked: false, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'r2', event_id: EVENT, hotel_id: 'h1', room_number: '102', room_type: 'Deluxe', floor: null, capacity: 2, max_capacity: 3, is_blocked: false, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'r3', event_id: EVENT, hotel_id: 'h1', room_number: '103', room_type: 'Deluxe', floor: null, capacity: 2, max_capacity: 3, is_blocked: false, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
      { id: 'r4', event_id: EVENT, hotel_id: 'h1', room_number: '104', room_type: 'Deluxe', floor: null, capacity: 2, max_capacity: 3, is_blocked: false, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' },
    ],
    hotels: [{ id: 'h1', event_id: EVENT, name: 'Grand Hotel', address: null, contact_name: null, contact_mobile: null, notes: null, created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z' }],
    profileNames: {},
    staffNames: {},
    callAttempts: [],
    extractions: [],
  }
}

/** Sum the numeric cells of a named column on a sheet, or 0 for empty cells. */
function columnTotal(wb: XLSX.WorkBook, sheetName: string, header: string): number {
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
  const headerRow = aoa[0].map((c) => String(c ?? ''))
  const col = headerRow.indexOf(header)
  expect(col, `${sheetName} has no "${header}" column`).toBeGreaterThanOrEqual(0)
  let total = 0
  for (let r = 1; r < aoa.length; r++) {
    const v = aoa[r][col]
    if (typeof v === 'number') total += v
  }
  return total
}

describe('F1 — PAX columns show the family guest count, not 1', () => {
  it('Guest Master totals 7 across three families (per family row)', () => {
    const wb = buildWorkbook(buildSheetDefinitions(makeData()))
    expect(columnTotal(wb, 'Guest Master', 'Pax')).toBe(7)
  })

  it('Family Heads totals 7 (expected pax per family)', () => {
    const wb = buildWorkbook(buildSheetDefinitions(makeData()))
    expect(columnTotal(wb, 'Family Heads', 'Expected pax')).toBe(7)
  })

  it('Arrivals and Departures each total 7 (per family leg)', () => {
    const wb = buildWorkbook(buildSheetDefinitions(makeData()))
    expect(columnTotal(wb, 'Arrivals', 'Pax')).toBe(7)
    expect(columnTotal(wb, 'Departures', 'Pax')).toBe(7)
  })

  it('Room Allocation totals 7 — PAX on the head row only, blank on member rows', () => {
    const wb = buildWorkbook(buildSheetDefinitions(makeData()))
    expect(columnTotal(wb, 'Room Allocation', 'PAX')).toBe(7)

    const ws = wb.Sheets['Room Allocation']
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    const headerRow = aoa[0].map((c) => String(c ?? ''))
    const paxCol = headerRow.indexOf('PAX')
    const guestCol = headerRow.indexOf('Guest')

    // Family 1's four rows: exactly one carries the count (the head), the rest
    // are blank — otherwise the column would total 16 for that family alone.
    const rows = aoa.slice(1)
    const familyOne = rows.filter((r) => ['Four A', 'Four B', 'Four C', 'Four D'].includes(String(r[guestCol])))
    expect(familyOne).toHaveLength(4)
    expect(familyOne.filter((r) => r[paxCol] === 4)).toHaveLength(1)
    expect(familyOne.filter((r) => r[paxCol] === '' || r[paxCol] === undefined)).toHaveLength(3)
  })

  it('a confirmed family exports its confirmed count, not the stale expected 1', () => {
    const data = makeData()
    // The import defaulted this family to expected_pax 1; a caller then
    // confirmed 6. The export must show 6, not 1.
    data.groups[2].expected_pax = 1
    data.groups[2].confirmed_pax = 6
    const wb = buildWorkbook(buildSheetDefinitions(data))

    // Guest Master, Arrivals and Departures (the family guest count) now read 6.
    expect(columnTotal(wb, 'Guest Master', 'Pax')).toBe(4 + 2 + 6)
    expect(columnTotal(wb, 'Arrivals', 'Pax')).toBe(4 + 2 + 6)
    expect(columnTotal(wb, 'Departures', 'Pax')).toBe(4 + 2 + 6)
  })
})
