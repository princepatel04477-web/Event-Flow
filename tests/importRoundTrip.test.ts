/**
 * THE ROUND TRIP — the app's own export, handed straight back to the import.
 *
 * This is the failure the operator actually hits. `buildSheetDefinitions`
 * names the guest tab "Guest Master"; the importer used to insist on a tab
 * called "Sheet1". So exporting the guest list and re-importing it failed with
 * "That workbook has no sheet named Sheet1" — a file the app itself wrote.
 *
 * Every case here goes through the REAL entry point (`parseImportFile`) with a
 * real `File`, the same one the upload screen builds, because the bug lived in
 * the sheet-selection layer that a unit test on `parseFamilies` cannot see.
 *
 * The invariants, in the operator's words:
 *   - the export round-trips: same families, nothing orphaned, nothing critical
 *   - a plain Name + Number sheet imports, whatever the tab is called and
 *     however the two headers are spelled
 *   - the old CALLING_MASTER_LIST shape still resolves (auto-detect)
 *   - a sheet that truly cannot be read says WHICH column is missing
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

import { buildSheetDefinitions } from '@/lib/export/definitions'
import { buildWorkbook } from '@/lib/export/workbook'
import type { ExportData, GuestGroupRow } from '@/lib/export/sheets'
import type { ParseFamiliesOptions } from '@/lib/import/families'
import { parseImportFile } from '@/lib/import/knownSheet'

/** 3–8 December 2026, matching tests/helpers/sheet.ts. */
const EVENT: ParseFamiliesOptions = {
  eventStartsOn: '2026-12-03',
  eventEndsOn: '2026-12-08',
}

function group(overrides: Partial<GuestGroupRow> & Pick<GuestGroupRow, 'id' | 'group_code' | 'head_name'>): GuestGroupRow {
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
    ...overrides,
  }
}

function makeData(): ExportData {
  return {
    groups: [
      group({ id: 'g1', group_code: '1', head_name: 'Rajesh Kumar', primary_mobile: '09876543213', city: 'Ahmedabad', expected_pax: 1 }),
      group({ id: 'g2', group_code: '2', head_name: 'Sunita Patel', primary_mobile: '+919876543210', city: 'Vadodara', expected_pax: 1 }),
    ],
    legs: [],
    guests: [],
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

/** Write a workbook to an in-memory `File`, exactly as the browser hands it over. */
function toFile(wb: XLSX.WorkBook, name: string): File {
  const buffer = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/** A bare workbook from a raw sheet, for the simple-shape cases. */
function sheetFile(
  sheets: { name: string; aoa: unknown[][] }[],
  fileName = 'guests.xlsx',
): File {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name)
  return toFile(wb, fileName)
}

describe('export -> import round trip', () => {
  it('imports the app\'s own export back, with the same families', async () => {
    const data = makeData()
    const file = toFile(buildWorkbook(buildSheetDefinitions(data)), 'event.xlsx')

    const outcome = await parseImportFile(file, EVENT)

    // The export's guest tab is "Guest Master", not "Sheet1" — the importer
    // must find it anyway.
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.sheetName).toBe('Guest Master')
    expect(outcome.result.counts.families).toBe(data.groups.length)
    expect(outcome.result.counts.orphans).toBe(0)
    expect(outcome.result.counts.criticalWarnings).toBe(0)

    const names = outcome.result.families.map((f) => f.headName)
    expect(names).toEqual(['Rajesh Kumar', 'Sunita Patel'])
    // Leading-zero mobile survives the trip as 10 digits.
    expect(outcome.result.families[0].primaryMobile).toBe('9876543213')
  })
})

describe('a plain Name + Number sheet', () => {
  it('imports whatever the tab is called', async () => {
    const file = sheetFile([
      {
        name: 'Contacts',
        aoa: [
          ['Name', 'Contact'],
          ['Amit Shah', '9876500001'],
          ['Priya Desai', '9876500002'],
        ],
      },
    ])

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.sheetName).toBe('Contacts')
    expect(outcome.result.counts.families).toBe(2)
    expect(outcome.result.counts.orphans).toBe(0)
  })

  it('accepts common header spellings for name and number', async () => {
    const file = sheetFile([
      {
        name: 'List',
        aoa: [
          ['Guest Name', 'Phone Number'],
          ['Amit Shah', '9876500001'],
        ],
      },
    ])

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.families[0].headName).toBe('Amit Shah')
    expect(outcome.result.families[0].primaryMobile).toBe('9876500001')
  })

  it('matches headers case- and space-insensitively', async () => {
    const file = sheetFile([
      {
        name: 'List',
        aoa: [
          ['  name ', 'MOBILE  NO'],
          ['Amit Shah', '9876500001'],
        ],
      },
    ])

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.counts.families).toBe(1)
  })
})

describe('the old CALLING_MASTER_LIST layout still resolves', () => {
  it('reads the Sheet1 shape when it is the guest tab', async () => {
    const file = sheetFile([
      {
        name: 'Sheet1',
        aoa: [
          ['U', 'SR.NO', '', 'PLACE', 'CONTACT', 'Pax', 'Arrival Date', 'Time', 'Mode', 'Details', 'Pick up', 'Remark', 'Departure Date', 'Time', 'Mode', 'Details', 'Drop'],
          [1, 1, 'RAMESH SHARMA', 'SURAT', 9876543210, 1, '4TH', '10:30', 'Train', '19004', 'Surat Station', '', '6TH', '18:00', 'Train', '19003', 'Surat Station'],
        ],
      },
    ])

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.result.families[0].headName).toBe('RAMESH SHARMA')
    expect(outcome.result.families[0].primaryMobile).toBe('9876543210')
  })
})

describe('a sheet that cannot be read names the missing column', () => {
  it('says what a name/number sheet needs, not a wall of missing headers', async () => {
    const file = sheetFile([
      {
        name: 'Whatever',
        aoa: [
          ['Fruit', 'Colour'],
          ['Apple', 'Red'],
        ],
      },
    ])

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    // The plain-language line names a column the operator can go and add.
    expect(outcome.reason.toLowerCase()).toContain('name')
  })
})

describe('the shipped template', () => {
  it('imports as a name + number list, so a bad asset can never ship', async () => {
    // The file `npm run build` puts at /nuvent-guest-list-template.xlsx,
    // exercised through the same parser the upload screen uses.
    const path = fileURLToPath(new URL('../public/nuvent-guest-list-template.xlsx', import.meta.url))
    const file = new File([readFileSync(path)], 'nuvent-guest-list-template.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    const outcome = await parseImportFile(file, EVENT)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    expect(outcome.result.counts.families).toBe(2)
    expect(outcome.result.counts.orphans).toBe(0)
    expect(outcome.result.families[0].headName).toBe('RAMESH SHARMA')
    expect(outcome.result.families[0].primaryMobile).toBe('9876543210')
  })
})
