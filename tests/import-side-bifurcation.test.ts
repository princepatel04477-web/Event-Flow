import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import {
  groupByFamilyHead,
  groupBySide,
  sideLabel,
  type GuestRow,
} from '@/app/(staff)/[eventCode]/guests/list/_components/format'
import { buildSheetDefinitions } from '@/lib/export/definitions'
import type { ExportData, GuestGroupRow } from '@/lib/export/sheets'
import { buildWorkbook } from '@/lib/export/workbook'
import { parseContactsSheet, parseCustomMapping, resolveContactsGrid } from '@/lib/import/contactsSheet'
import { parseImportFile } from '@/lib/import/knownSheet'
import { parseSideAndSubSide, resolveImportedSide } from '@/lib/import/normalize'
import { formatSideLabel } from '@/lib/side'

const EVENT = { eventStartsOn: '2026-12-03', eventEndsOn: '2026-12-08' }

function makeGroup(
  over: Pick<GuestGroupRow, 'id' | 'group_code' | 'head_name'> & Partial<GuestGroupRow>,
): GuestGroupRow {
  return {
    event_id: 'e1',
    primary_mobile: null,
    alt_mobile: null,
    side: null,
    sub_side: null,
    group_type: 'family',
    city: null,
    expected_pax: 2,
    confirmed_pax: null,
    adults_confirmed: null,
    children_confirmed: null,
    expected_adults: null,
    expected_children: null,
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
    ...over,
  }
}

function makeProfileRow(
  over: Pick<GuestRow, 'guest_id' | 'guest_name' | 'family_head'> & Partial<GuestRow>,
): GuestRow {
  return {
    event_id: 'e1',
    group_type: 'family',
    side: null,
    sub_side: null,
    pax: 2,
    rsvp_status: 'not_started',
    hotel_name: null,
    room_number: null,
    arrival_date: null,
    arrival_time: null,
    arrival_mode: null,
    arrival_point: null,
    departure_date: null,
    departure_time: null,
    departure_mode: null,
    departure_point: null,
    hamper_delivered: false,
    return_gift_delivered: null,
    needs_return_gift: false,
    ...over,
  }
}

function workbookFile(sheets: Array<{ name: string; rows: unknown[][] }>, filename = 'guests.xlsx'): File {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    XLSX.utils.book_append_sheet(wb, ws, s.name)
  }
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([bytes], filename, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('parseSideAndSubSide & resolveImportedSide', () => {
  it('parses combined side and sub-side labels for both Groom and Bride branches', () => {
    expect(parseSideAndSubSide("Groom's Father Side")).toEqual({ side: 'groom', subSide: 'father' })
    expect(parseSideAndSubSide("Groom's Mother Side")).toEqual({ side: 'groom', subSide: 'mother' })
    expect(parseSideAndSubSide("Bride's Father Side")).toEqual({ side: 'bride', subSide: 'father' })
    expect(parseSideAndSubSide("Bride's Mother Side")).toEqual({ side: 'bride', subSide: 'mother' })
    expect(parseSideAndSubSide('Paternal Groom')).toEqual({ side: 'groom', subSide: 'father' })
    expect(parseSideAndSubSide('Maternal Bride')).toEqual({ side: 'bride', subSide: 'mother' })
    expect(parseSideAndSubSide('GF')).toEqual({ side: 'groom', subSide: 'father' })
    expect(parseSideAndSubSide('BM')).toEqual({ side: 'bride', subSide: 'mother' })
  })

  it('merges separate Side and Branch columns cleanly', () => {
    expect(parseSideAndSubSide('Groom', "Father's Side")).toEqual({ side: 'groom', subSide: 'father' })
    expect(parseSideAndSubSide('Groom', 'Maternal')).toEqual({ side: 'groom', subSide: 'mother' })
    expect(parseSideAndSubSide('Bride', 'Paternal')).toEqual({ side: 'bride', subSide: 'father' })
    expect(parseSideAndSubSide('Bride', "Mother's Side")).toEqual({ side: 'bride', subSide: 'mother' })
  })

  it('clears sub-side when side is both or other', () => {
    expect(parseSideAndSubSide('Both', 'Father')).toEqual({ side: 'both', subSide: null })
    expect(parseSideAndSubSide('VIP', 'Mother')).toEqual({ side: 'other', subSide: null })
  })

  it('falls back to defaultSide / defaultSubSide without leaking sub-side across mismatched sides', () => {
    expect(resolveImportedSide(null, null, 'groom', 'father')).toEqual({
      side: 'groom',
      subSide: 'father',
    })
    // Explicit Bride row in a sheet uploaded while Groom/Father default was selected:
    expect(resolveImportedSide('Bride', null, 'groom', 'father')).toEqual({
      side: 'bride',
      subSide: null,
    })
    // Explicit Groom row inherits Father when default is Groom/Father:
    expect(resolveImportedSide('Groom', null, 'groom', 'father')).toEqual({
      side: 'groom',
      subSide: 'father',
    })
  })
})

describe('contacts & flexible mapping side bifurcation', () => {
  it('auto-detects Side and Sub-side columns in a contacts grid', () => {
    const grid: unknown[][] = [
      ['Name', 'Mobile', 'Side', 'Family Branch'],
      ['Amit Shah', '9876543210', 'Groom', "Father's Side"],
      ['Neha Patel', '9876543211', 'Groom', "Mother's Side"],
      ['Rohan Mehta', '9876543212', "Bride's Father Side", ''],
      ['Kavita Joshi', '9876543213', 'Bride', 'Maternal'],
    ]

    const resolved = resolveContactsGrid(grid, 'Guests')
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return

    const parsed = parseContactsSheet(resolved.sheet, EVENT)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.result.families.map((f) => [f.headName, f.side, f.subSide])).toEqual([
      ['Amit Shah', 'groom', 'father'],
      ['Neha Patel', 'groom', 'mother'],
      ['Rohan Mehta', 'bride', 'father'],
      ['Kavita Joshi', 'bride', 'mother'],
    ])
  })

  it('applies import-level Groom/Bride + Father/Mother defaults when sheet has no Side column', () => {
    const grid: unknown[][] = [
      ['Guest Name', 'Phone'],
      ['Vikram Rao', '9876500001'],
      ['Suresh Rao', '9876500002'],
    ]

    const parsed = parseCustomMapping(
      grid,
      'List',
      0,
      { nameIndex: 0, contactIndex: 1 },
      { ...EVENT, defaultSide: 'bride', defaultSubSide: 'mother' },
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.result.families).toHaveLength(2)
    expect(parsed.result.families[0].side).toBe('bride')
    expect(parsed.result.families[0].subSide).toBe('mother')
    expect(parsed.result.families[1].side).toBe('bride')
    expect(parsed.result.families[1].subSide).toBe('mother')
  })
})

describe('workbook import & export round-trip with side bifurcation', () => {
  it('infers side & branch from tab name when uploaded without an explicit selector', async () => {
    const file = workbookFile([
      {
        name: "Groom's Father Side",
        rows: [
          ['Name', 'Contact'],
          ['Harish Kulkarni', '9811111111'],
        ],
      },
    ])

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.families[0].side).toBe('groom')
    expect(outcome.result.families[0].subSide).toBe('father')
  })

  it('preserves Groom/Bride Father/Mother bifurcation through export and re-import', async () => {
    const data: ExportData = {
      groups: [
        makeGroup({ id: 'g1', group_code: '1', head_name: 'Rajesh Kumar', side: 'groom', sub_side: 'father' }),
        makeGroup({ id: 'g2', group_code: '2', head_name: 'Meena Patel', side: 'groom', sub_side: 'mother' }),
        makeGroup({ id: 'g3', group_code: '3', head_name: 'Anil Mehta', side: 'bride', sub_side: 'father' }),
        makeGroup({ id: 'g4', group_code: '4', head_name: 'Sita Verma', side: 'bride', sub_side: 'mother' }),
      ],
      legs: [],
      deliverables: [],
      proofs: [],
      assignments: [],
      guests: [],
      rooms: [],
      hotels: [],
      profileNames: {},
      staffNames: {},
      callAttempts: [],
      extractions: [],
      recordings: [],
      transcripts: [],
    }

    const wb = buildWorkbook(buildSheetDefinitions(data))
    const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const file = new File([bytes], 'roundtrip.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const reimported = await parseImportFile(file, EVENT)
    expect(reimported.ok).toBe(true)
    if (!reimported.ok) return

    expect(reimported.result.families.map((f) => [f.headName, f.side, f.subSide])).toEqual([
      ['Rajesh Kumar', 'groom', 'father'],
      ['Meena Patel', 'groom', 'mother'],
      ['Anil Mehta', 'bride', 'father'],
      ['Sita Verma', 'bride', 'mother'],
    ])
  })
})

describe('side labels and guest-list grouping', () => {
  it('formats all four bifurcated labels cleanly', () => {
    expect(formatSideLabel('groom', 'father')).toBe("Groom's Father Side")
    expect(formatSideLabel('groom', 'mother')).toBe("Groom's Mother Side")
    expect(formatSideLabel('bride', 'father')).toBe("Bride's Father Side")
    expect(formatSideLabel('bride', 'mother')).toBe("Bride's Mother Side")
    expect(sideLabel('groom', 'father')).toBe("Groom's Father Side")
    expect(sideLabel('bride', 'mother')).toBe("Bride's Mother Side")
  })

  it('groups guest-list families into Groom Father/Mother and Bride Father/Mother sections', () => {
    const rows: GuestRow[] = [
      makeProfileRow({ guest_id: '1', guest_name: 'A', family_head: 'G-Dad', side: 'groom', sub_side: 'father' }),
      makeProfileRow({ guest_id: '2', guest_name: 'B', family_head: 'G-Mom', side: 'groom', sub_side: 'mother' }),
      makeProfileRow({ guest_id: '3', guest_name: 'C', family_head: 'B-Dad', side: 'bride', sub_side: 'father' }),
      makeProfileRow({ guest_id: '4', guest_name: 'D', family_head: 'B-Mom', side: 'bride', sub_side: 'mother' }),
    ]
    const sections = groupBySide(groupByFamilyHead(rows))
    expect(sections.map((s) => s.label)).toEqual([
      "Groom's Father Side",
      "Groom's Mother Side",
      "Bride's Father Side",
      "Bride's Mother Side",
    ])
  })
})
