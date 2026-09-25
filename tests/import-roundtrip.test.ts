/**
 * The round trip: EXPORT the guest list, then IMPORT that same file.
 *
 * This is the acceptance test for the ticket. The exporter has always claimed
 * round-trip safety in its header comment — the Guest Master sheet reproduces
 * the importer's header row and the identity cells behind `source_row_hash` —
 * but nothing exercised the second half of that claim, and the half that was
 * broken was not the headers. The export's guest list lives on a tab named
 * "Guest Master"; the importer demanded a tab named "Sheet1" and stopped with
 * `no sheet named "Sheet1"`. A file the app wrote could not be read back.
 *
 * So this writes the workbook through the REAL exporter, hands the bytes to
 * the REAL importer through a `File`, and asserts what the operator would see:
 * the import resolves, every family is placed, nothing is orphaned, and the
 * identity hash each row computes is the one the export wrote — which is what
 * makes a re-import an UPDATE rather than 238 duplicates.
 */

import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'

import { buildSheetDefinitions } from '@/lib/export/definitions'
import type { ExportData, GuestGroupRow, TravelLegRow } from '@/lib/export/sheets'
import { buildExportTemplateWorkbook } from '@/lib/export/template'
import { buildWorkbook } from '@/lib/export/workbook'
import { rowHash } from '@/lib/import/hash'
import { parseImportFile } from '@/lib/import/knownSheet'
import { normaliseMobile } from '@/lib/import/normalize'

/** The event window every fixture date must fall inside, or ordinals stay raw. */
const EVENT = { eventStartsOn: '2026-12-03', eventEndsOn: '2026-12-08' }

function group(
  over: Pick<GuestGroupRow, 'id' | 'group_code' | 'head_name'> & Partial<GuestGroupRow>,
): GuestGroupRow {
  return {
    event_id: 'e1',
    primary_mobile: null,
    alt_mobile: null,
    side: null,
    group_type: 'family',
    city: null,
    expected_pax: 1,
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
    ...over,
  }
}

function leg(
  over: Pick<TravelLegRow, 'id' | 'group_id' | 'direction'> & Partial<TravelLegRow>,
): TravelLegRow {
  return {
    event_id: 'e1',
    mode: null,
    travel_date: null,
    travel_time: null,
    reference: null,
    point: null,
    needs_transport: false,
    pax_on_leg: null,
    arrived_at: null,
    departed_at: null,
    source: 'excel_import',
    notes: null,
    created_by: null,
    created_by_staff: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
    ...over,
  }
}

/**
 * Three families: a two-row family with both travel legs, a confirmed one that
 * needs a return gift, and a four-person groom-side one. Between them they
 * carry every column the Guest Master sheet writes.
 */
function fixture(): ExportData {
  return {
    groups: [
      group({
        id: 'g1',
        group_code: '1',
        head_name: 'Rajesh Kumar',
        primary_mobile: '09876543213',
        city: 'Ahmedabad',
        expected_pax: 2,
      }),
      group({
        id: 'g2',
        group_code: '2',
        head_name: 'Sunita Patel',
        primary_mobile: '+919876543210',
        city: 'Vadodara',
        expected_pax: 1,
        remarks: 'Return gift needed',
      }),
      group({
        id: 'g3',
        group_code: '3',
        head_name: 'Mohan Shah',
        primary_mobile: '9123456780',
        city: 'Surat',
        expected_pax: 4,
        side: 'groom',
      }),
    ],
    guests: [],
    legs: [
      leg({
        id: 'l1',
        group_id: 'g1',
        direction: 'arrival',
        mode: 'train',
        travel_date: '2026-12-04',
        travel_time: '10:30:00',
        reference: '19004',
        point: 'Vadodara',
      }),
      leg({
        id: 'l2',
        group_id: 'g1',
        direction: 'departure',
        mode: 'train',
        travel_date: '2026-12-06',
        travel_time: '18:00:00',
        reference: '19003',
        point: 'Surat',
      }),
    ],
    deliverables: [],
    proofs: [],
    assignments: [],
    rooms: [],
    hotels: [],
    callAttempts: [],
    extractions: [],
    profileNames: {},
    staffNames: {},
  }
}

/** The workbook's bytes, as the browser hands them to the importer. */
function asFile(wb: XLSX.WorkBook, name = 'EventFlow_export.xlsx'): File {
  const bytes = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  return new File([bytes], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('export -> import round trip', () => {
  it('reads the sheet the app exports, on its "Guest Master" tab', async () => {
    const data = fixture()
    const wb = buildWorkbook(buildSheetDefinitions(data))

    const outcome = await parseImportFile(asFile(wb), EVENT)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // `layout` only exists on the full known-layout read, so its presence is
    // how we know this was NOT quietly downgraded to the name+mobile fallback.
    expect('layout' in outcome).toBe(true)
    expect(outcome.sheetName).toBe('Guest Master')
    expect(outcome.result.counts.families).toBe(data.groups.length)
    expect(outcome.result.counts.orphans).toBe(0)
    expect(outcome.result.counts.criticalWarnings).toBe(0)
    expect(outcome.result.counts.blockedFamilies).toBe(0)
  })

  it('recomputes each family identity from the exported cells (update, not duplicate)', async () => {
    const data = fixture()
    const wb = buildWorkbook(buildSheetDefinitions(data))

    const outcome = await parseImportFile(asFile(wb), EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    data.groups.forEach((g, i) => {
      const family = outcome.result.families[i]
      // The mobile the export wrote, reduced exactly as the import reduces it:
      // the hash is computed from the normalised number, both when the family
      // was first created and when the sheet is read back.
      const mobile = normaliseMobile(g.primary_mobile).value

      expect(family.headName).toBe(g.head_name)
      expect(family.primaryMobile).toBe(mobile)
      expect(family.place).toBe(g.city)
      expect(family.expectedPax).toBe(g.expected_pax)
      expect(family.familyNumber).toBe(g.group_code)
      // The load-bearing assertion: `commit_guest_import` matches on
      // `source_row_hash`, so an identical hash is the whole reason a re-import
      // updates in place instead of inserting 238 duplicates.
      expect(family.hash).toBe(
        rowHash({
          groupCode: g.group_code ?? '',
          headName: g.head_name,
          primaryMobile: mobile,
        }),
      )
    })
  })

  it('reads back the blank template it offers for download', async () => {
    // The "Download template" button builds exactly this workbook, so if the
    // template does not import, the button is a trap rather than a shortcut.
    const outcome = await parseImportFile(
      asFile(buildExportTemplateWorkbook(), 'EventFlow_guest_export_template.xlsx'),
      EVENT,
    )

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect('layout' in outcome).toBe(true)
    expect(outcome.sheetName).toBe('Guest Master')
    expect(outcome.result.counts.families).toBe(0)
    expect(outcome.result.counts.criticalWarnings).toBe(0)
  })

  it('still reads the legacy calling-list template, found by its headers', async () => {
    const HEADERS = [
      'U', 'SR.NO', '', 'PLACE', 'CONTACT', 'ID', 'Romm', 'bed', 'Pax',
      'Arrival Date', 'Time', 'Mode', 'Details', 'Pick up', 'Remark',
      'Departure Date', 'Time', 'Mode', 'Details', 'Drop',
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        HEADERS,
        [1, 1, 'RAMESH SHARMA', 'SURAT', 9876543210, '', '', '', 2, '4TH', '10:30', 'Train',
          '19004', 'Surat Station', 'Bride side', '6TH', '18:00', 'Train', '19003', 'Surat Station'],
        ['', 2, 'SUNITA SHARMA', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
        [2, 1, 'MOHAN PATEL', 'BARODA', 9123456780, '', '', '', 1, '5TH', '14:00', 'By Road',
          '', 'Hotel', 'Groom side', '7TH', '09:00', 'By Road', '', 'Hotel'],
      ]),
      'Sheet1',
    )

    const outcome = await parseImportFile(asFile(wb, 'calling-list.xlsx'), EVENT)

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect('layout' in outcome).toBe(true)
    expect(outcome.sheetName).toBe('Sheet1')
    // Two families, and the continuation row became a person rather than an
    // orphan: members is the count that would drop if the tab were misread.
    expect(outcome.result.counts.families).toBe(2)
    expect(outcome.result.counts.members).toBe(3)
    expect(outcome.result.counts.orphans).toBe(0)
    expect(outcome.result.counts.criticalWarnings).toBe(0)
  })

  it('names the missing column AND the header it expects', async () => {
    // The export's own header row with CONTACT removed. Everything else is
    // correct, so exactly one column can be reported.
    const HEADERS = [
      '_id', 'U', 'SR.NO', '', 'PLACE', 'Pax', 'Arrival Date', 'Time', 'Mode',
      'Details', 'Pick up', 'Remark', 'Departure Date', 'Time', 'Mode', 'Details', 'Drop',
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([HEADERS, ['g1', '1', '1', 'Rajesh Kumar', 'Ahmedabad', 2]]),
      'Guest Master',
    )

    const outcome = await parseImportFile(asFile(wb), EVENT)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return

    const contact = outcome.missing.find((m) => m.column === 'contact')
    expect(contact).toBeDefined()
    // Not a generic "does not match the layout": the header to type is given.
    expect(contact?.detail).toContain('Expected one of')
    expect(contact?.detail).toContain('"contact"')
    expect(outcome.reason).toContain('short of the guest-list format')
    expect(outcome.reason).toContain('CONTACT')
  })
})
