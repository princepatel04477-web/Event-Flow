import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { buildWorkbook, phoneCell, timeToExcel } from '@/lib/export/workbook'
import { buildSheetDefinitions } from '@/lib/export/definitions'
import { buildGuestMasterRows, buildDeliverableRows, type ExportData } from '@/lib/export/sheets'
import { rowHash } from '@/lib/import/hash'

// ---------------------------------------------------------------------------
// A minimal fixture mirroring the real guest_groups/travel_legs shapes.
// ---------------------------------------------------------------------------

function makeData(): ExportData {
  return {
    groups: [
      {
        id: 'g1',
        event_id: 'e1',
        group_code: '1',
        head_name: 'Rajesh Kumar',
        primary_mobile: '09876543213',
        alt_mobile: null,
        side: 'bride',
        group_type: 'family',
        city: 'Ahmedabad',
        expected_pax: 2,
        confirmed_pax: null,
        adults_confirmed: null,
        children_confirmed: null,
        rsvp_status: 'not_started',
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
      },
      {
        id: 'g2',
        event_id: 'e1',
        group_code: '2',
        head_name: 'Sunita Patel',
        primary_mobile: '+919876543210',
        alt_mobile: null,
        side: 'groom',
        group_type: 'family',
        city: 'Vadodara',
        expected_pax: 2,
        confirmed_pax: null,
        adults_confirmed: null,
        children_confirmed: null,
        rsvp_status: 'confirmed',
        needs_return_gift: true,
        priority: 0,
        remarks: 'Return gift needed',
        locked_by: null,
        locked_by_staff: null,
        locked_until: null,
        last_opened_by_staff: null,
        last_opened_at: null,
        source_row_hash: null,
        needs_pickup: false,
        special_requirements: [],
        callback_at: null,
        call_count: 1,
        created_at: '2026-08-01T00:00:00Z',
        created_by: null,
        created_by_staff: null,
        updated_at: '2026-08-01T00:00:00Z',
      },
    ],
    legs: [
      {
        id: 'l1',
        event_id: 'e1',
        group_id: 'g1',
        direction: 'arrival',
        mode: 'train',
        travel_date: '2026-12-19',
        travel_time: '10:30:00',
        reference: '19004',
        point: 'Vadodara',
        needs_transport: true,
        pax_on_leg: null,
        arrived_at: null,
        departed_at: null,
        source: 'rsvp_call',
        notes: null,
        created_by: null,
        created_by_staff: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
    ],
    deliverables: [],
    proofs: [],
    assignments: [],
    rooms: [],
    hotels: [],
    profileNames: {},
    staffNames: {},
    callAttempts: [],
    extractions: [],
  }
}

// ---------------------------------------------------------------------------
// Round-trip: the export's Guest Master must reproduce the identity cells so
// the import hash matches, guaranteeing UPDATE-not-INSERT on re-import.
// ---------------------------------------------------------------------------

describe('export round-trip', () => {
  it('reproduces identity cells so re-import computes the same hash (zero duplicates)', () => {
    const data = makeData()
    const rows = buildGuestMasterRows(data)
    const wb = buildWorkbook(buildSheetDefinitions(data))

    // Read the Guest Master sheet back with SheetJS, as the importer would.
    const ws = wb.Sheets['Guest Master']
    expect(ws).toBeDefined()
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]

    // Header row + one row per family + 0 blank rows.
    expect(aoa.length).toBe(3)

    // The exported cells must reproduce the import's identity inputs.
    const header = aoa[0].map((c) => String(c ?? ''))
    const uIdx = header.indexOf('U')
    const nameIdx = header.indexOf('')
    const contactIdx = header.indexOf('CONTACT')

    for (let i = 0; i < rows.length; i++) {
      const exportRow = rows[i]
      const sheetRow = aoa[i + 1]

      // Same hash the import would compute from these cells.
      const exportedHash = rowHash({
        groupCode: String(sheetRow[uIdx] ?? ''),
        headName: String(sheetRow[nameIdx] ?? ''),
        primaryMobile: String(sheetRow[contactIdx] ?? ''),
      })

      const expectedHash = rowHash({
        groupCode: exportRow.u,
        headName: exportRow.name,
        primaryMobile: exportRow.contact,
      })

      expect(exportedHash).toBe(expectedHash)
      // And the _id column carries the group UUID.
      expect(String(sheetRow[0])).toBe(data.groups[i].id)
    }

    // The identity values themselves survive: leading-zero phone intact,
    // +91 phone intact (both forced to string cells).
    expect(String(aoa[1][contactIdx])).toBe('09876543213')
    expect(String(aoa[2][contactIdx])).toBe('+919876543210')
  })

  it('the Guest Master headers match the import layout exactly', () => {
    const wb = buildWorkbook(buildSheetDefinitions(makeData()))
    const ws = wb.Sheets['Guest Master']
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    const header = aoa[0].map((c) => String(c ?? ''))

    // The known layout's expected header sequence (positionally), with _id first.
    expect(header[0]).toBe('_id')
    expect(header[1]).toBe('U')
    expect(header[2]).toBe('SR.NO')
    expect(header[4]).toBe('PLACE')
    expect(header[5]).toBe('CONTACT')
    expect(header[7]).toBe('Arrival Date')
    expect(header[13]).toBe('Departure Date')
  })
})

// ---------------------------------------------------------------------------
// Format traps
// ---------------------------------------------------------------------------

describe('format traps', () => {
  it('writes phone numbers as string cells, never numbers', () => {
    const data = makeData()
    const wb = buildWorkbook(buildSheetDefinitions(data))
    const ws = wb.Sheets['Guest Master']
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    const header = aoa[0].map((c) => String(c ?? ''))
    const contactIdx = header.indexOf('CONTACT')

    const leadingZero = aoa[1][contactIdx]
    const plus91 = aoa[2][contactIdx]

    // Raw cell values: the leading-zero number is a STRING "09876543213",
    // not the number 9876543213.
    expect(typeof leadingZero).toBe('string')
    expect(leadingZero).toBe('09876543213')
    // The +91 stays a string too.
    expect(plus91).toBe('+919876543210')
  })

  it('writes dates as real date cells with the dd/mm/yyyy number format', () => {
    const data = makeData()
    data.assignments = [
      {
        id: 'ra1',
        event_id: 'e1',
        group_id: 'g1',
        guest_id: 'gu1',
        room_id: 'r1',
        assigned_at: '2026-08-01T00:00:00Z',
        assigned_by: null,
        assigned_by_staff: null,
        check_in_date: '2026-12-19',
        check_in_time: '10:30:00',
        check_out_date: '2026-12-24',
        check_out_time: null,
        checked_in_at: null,
        checked_out_at: null,
        released_at: null,
        release_reason: null,
        is_override: false,
        override_reason: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
    ]
    data.rooms = [
      {
        id: 'r1',
        event_id: 'e1',
        hotel_id: 'h1',
        room_number: '101',
        room_type: 'Deluxe',
        floor: null,
        capacity: 2,
        max_capacity: 3,
        is_blocked: false,
        notes: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
    ]
    data.hotels = [
      {
        id: 'h1',
        event_id: 'e1',
        name: 'Grand Hotel',
        address: null,
        contact_name: null,
        contact_mobile: null,
        notes: null,
        created_at: '2026-08-01T00:00:00Z',
        updated_at: '2026-08-01T00:00:00Z',
      },
    ]

    const wb = buildWorkbook(buildSheetDefinitions(data))
    const ws = wb.Sheets['Room Allocation']
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    const header = aoa[0].map((c) => String(c ?? ''))
    const checkInIdx = header.indexOf('Check-in')

    const cell = ws[XLSX.utils.encode_cell({ r: 1, c: checkInIdx })]
    expect(cell).toBeDefined()
    // A real date cell: a number (Excel serial date).
    expect(typeof cell!.v).toBe('number')
    // The number format is dd/mm/yyyy.
    expect(cell!.z).toBe('dd/mm/yyyy')
  })

  it('times convert to the hh:mm fraction', () => {
    expect(timeToExcel('10:30')).toBeCloseTo(10.5 / 24)
    expect(timeToExcel('23:59:59')).toBeCloseTo((23 * 3600 + 59 * 60 + 59) / 86400)
    expect(timeToExcel('25:00')).toBeNull()
    expect(timeToExcel('not a time')).toBeNull()
    expect(timeToExcel(null)).toBeNull()
  })

  it('phoneCell returns a string or empty, never coerces', () => {
    expect(phoneCell('09876543213')).toBe('09876543213')
    expect(phoneCell('+919876543210')).toBe('+919876543210')
    expect(phoneCell('')).toBe(null)
    expect(phoneCell(null)).toBe(null)
    expect(phoneCell('   ')).toBe(null)
  })

  it('NULLs write as empty cells, not "null" / "N/A" / 0', () => {
    const data = makeData()
    const wb = buildWorkbook(buildSheetDefinitions(data))
    const ws = wb.Sheets['Guest Master']
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as unknown[][]
    const header = aoa[0].map((c) => String(c ?? ''))
    const remarkIdx = header.indexOf('Remark')

    // Family 1 has remarks=null → the exported cell is empty ('' or undefined),
    // never the string "null", never "N/A", never 0.
    const cell = aoa[1][remarkIdx]
    expect(cell === undefined || cell === '').toBe(true)
    expect(cell).not.toBe('null')
    expect(cell).not.toBe('N/A')
    expect(cell).not.toBe(0)
  })

  it('freezes the header row and applies an autofilter on every sheet', () => {
    const data = makeData()
    const wb = buildWorkbook(buildSheetDefinitions(data))
    for (const sheetName of ['Guest Master', 'Family Heads', 'Room Allocation', 'Deliverables', 'Exceptions', 'RSVP Call Log', 'Arrivals', 'Departures']) {
      const ws = wb.Sheets[sheetName]
      expect(ws).toBeDefined()
      expect(ws['!freeze']).toEqual({ xSplit: 0, ySplit: 1, topLeftCell: 'A2' })
      expect(ws['!autofilter']).toBeDefined()
    }
  })

  it('Exceptions sheet amber-fills every row', () => {
    const data = makeData()
    const wb = buildWorkbook(buildSheetDefinitions(data))
    const ws = wb.Sheets['Exceptions']
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1')
    // Every data cell on the exceptions sheet carries the amber fill.
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: 0 })]
      expect(cell?.s?.fill?.fgColor?.rgb).toBe('FFF3CD')
    }
  })

  it('resolves deliveredBy from captured_by_staff (code-auth) or captured_by (legacy)', () => {
    const baseDeliv = {
      id: 'd1', event_id: 'e1', group_id: 'g1', kind: 'hamper' as const,
      item_name: 'Hamper', quantity: 1, status: 'delivered' as const,
      assigned_to: null, guest_id: null, room_id: null, notes: null,
      created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
    }

    // A code-auth proof: captured_by_staff set, captured_by null.
    const codeAuth = makeData()
    codeAuth.staffNames = { s1: 'Priya Staff' }
    codeAuth.deliverables = [baseDeliv]
    codeAuth.proofs = [{
      id: 'p1', event_id: 'e1', deliverable_id: 'd1',
      captured_by: null, captured_by_staff: 's1',
      recorded_at: '2026-08-01T10:00:00Z', storage_bucket: 'delivery-proofs',
      storage_path: 'e1/d1/x.jpg', photo_sha256: 'abc', file_size_bytes: 1,
      device_captured_at: null, latitude: null, longitude: null,
      received_by_name: null, notes: null,
    }]
    const rows = buildDeliverableRows(codeAuth)
    expect(rows[0].deliveredBy).toBe('Priya Staff')

    // A legacy proof: captured_by set (auth user), captured_by_staff null.
    const legacy = makeData()
    legacy.profileNames = { u1: 'Prince Admin' }
    legacy.deliverables = [baseDeliv]
    legacy.proofs = [{
      id: 'p2', event_id: 'e1', deliverable_id: 'd1',
      captured_by: 'u1', captured_by_staff: null,
      recorded_at: '2026-08-01T10:00:00Z', storage_bucket: 'delivery-proofs',
      storage_path: 'e1/d1/y.jpg', photo_sha256: 'def', file_size_bytes: 1,
      device_captured_at: null, latitude: null, longitude: null,
      received_by_name: null, notes: null,
    }]
    const rows2 = buildDeliverableRows(legacy)
    expect(rows2[0].deliveredBy).toBe('Prince Admin')
  })
})
