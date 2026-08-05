/**
 * Regenerates `tests/fixtures/CALLING_MASTER_LIST_FIXTURE.xlsx`.
 *
 *   npm run test:fixture
 *
 * WHY THIS EXISTS AS A SCRIPT AND NOT AS A CHECKED-IN BINARY ALONE
 * ---------------------------------------------------------------
 * The real CALLING_MASTER_LIST.xlsx is not in this repository and must never
 * be — it is 465 people's names and phone numbers. Everything the parser is
 * tested against therefore has to be synthetic. A .xlsx is an opaque zip, so
 * a reviewer cannot tell what a committed fixture asserts or whether someone
 * quietly edited a cell to make a test pass. This script is the readable
 * source of truth; the .xlsx is its build output and is committed only so the
 * suite runs without a generation step.
 *
 * WHAT THE FIXTURE DELIBERATELY REPRODUCES
 * ----------------------------------------
 * Each of these is a defect observed in, or a shape stated about, the real
 * workbook. Nothing here is invented for coverage's sake.
 *
 *   merged family blocks of 5, 1 and 2 members  (families 1, 2, 3)
 *   a mobile carrying a trailing ".0"           (family 1)
 *   a "+91 " mobile                             (family 2)
 *   a leading-0 trunk mobile                    (family 3)
 *   a mobile stored as a bare number            (family 4)
 *   a NON-INDIAN number                         (family 6)
 *   "Not Coming" and "Not Sure" remarks         (families 2, 3)
 *   "4TH " vs "4th " vs "9th"                   (families 1, 3, 2)
 *   a fully blank row mid-sheet                 (row 8)
 *   an orphan: blank U AND blank SR.NO          (row 14)
 *   an arrival with no departure                (families 3, 4, 5, 6)
 *   Romm/bed filled, and a family without them  (family 1 vs family 3)
 *   a nickname in parentheses                   (families 1, 2)
 *   a family whose PLACE and CONTACT are blank, sitting directly beneath a
 *   family that has both  (family 5 under family 4) — the regression guard
 *   for the bug where a blank phone cell acquired the neighbour's number.
 *
 * The event this fixture is parsed against is 3–8 December 2026, which is why
 * "4TH" must resolve and "9th" must not.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as XLSX from 'xlsx'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '..', 'tests', 'fixtures', 'CALLING_MASTER_LIST_FIXTURE.xlsx')

/**
 * The header row of Sheet1, in order. "Time", "Mode" and "Details" each appear
 * TWICE — once for arrival, once for departure — and the name column's header
 * cell is blank. Both facts are the point of the fixture: a parser that
 * resolves columns by name alone cannot read this row.
 */
const HEADERS = [
  'U',
  'SR.NO',
  '', // the name column — its header is blank in the real sheet
  'PLACE',
  'CONTACT',
  'ID',
  'Romm', // sic
  'bed',
  'Pax',
  'Arrival Date',
  'Time',
  'Mode',
  'Details',
  'Pick up',
  'Remark',
  'Departure Date',
  'Time',
  'Mode',
  'Details',
  'Drop',
]

interface RowSpec {
  u?: unknown
  sr?: unknown
  name?: unknown
  place?: unknown
  contact?: unknown
  id?: unknown
  room?: unknown
  bed?: unknown
  pax?: unknown
  arrDate?: unknown
  arrTime?: unknown
  arrMode?: unknown
  arrDetails?: unknown
  pickUp?: unknown
  remark?: unknown
  depDate?: unknown
  depTime?: unknown
  depMode?: unknown
  depDetails?: unknown
  drop?: unknown
}

const ORDER = [
  'u',
  'sr',
  'name',
  'place',
  'contact',
  'id',
  'room',
  'bed',
  'pax',
  'arrDate',
  'arrTime',
  'arrMode',
  'arrDetails',
  'pickUp',
  'remark',
  'depDate',
  'depTime',
  'depMode',
  'depDetails',
  'drop',
] as const satisfies readonly (keyof RowSpec)[]

/** An empty cell is written as `null`, which SheetJS omits entirely — the same
 *  thing a genuinely untouched cell looks like coming out of Excel. */
function toCells(spec: RowSpec): unknown[] {
  return ORDER.map((key) => spec[key] ?? null)
}

/** A fully blank row. Written as `[]` so no cells exist for it at all. */
const BLANK: unknown[] = []

const ROWS: unknown[][] = [
  HEADERS,

  // -- family 1: five members, trailing-".0" mobile, Romm/bed filled --------
  // Arrival "4TH " (upper case, trailing space) and the Excel day fraction
  // 0.4583, which is 10.9992 hours — it must round to 11:00, not truncate to
  // 10:59. Departure "8th", the last day of the event window.
  toCells({
    u: 1,
    sr: 1,
    name: 'RAMESH (RAMU) PATEL',
    place: 'AHMEDABAD',
    contact: '9425155093.0',
    id: 'ID-001',
    room: '101',
    bed: '2',
    pax: 5,
    arrDate: '4TH ',
    arrTime: 0.4583,
    arrMode: 'BY Road ',
    pickUp: 'Ahmedabad T2',
    depDate: '8th',
    depTime: '18:30',
    depMode: 'Flight',
    depDetails: '6E 5074',
    drop: 'Ahmedabad T2',
  }),
  toCells({ sr: 2, name: 'GEETA PATEL', room: '101', bed: '2' }),
  toCells({ sr: 3, name: 'NIKHIL PATEL', room: '102', bed: '1' }),
  toCells({ sr: 4, name: 'PRIYA PATEL', room: '102', bed: '1' }),
  toCells({ sr: 5, name: 'AARAV PATEL' }),

  // -- family 2: one member, "+91 " mobile, "Not Coming", "9th" ------------
  // "9th" falls outside 3–8 Dec, so it must be reported and kept as raw text
  // rather than resolved to some other month.
  toCells({
    u: 2,
    sr: 1,
    name: 'SUNITA (RITA) PATEL',
    place: 'SURAT',
    contact: '+91 94251 55093',
    pax: 1,
    arrDate: '9th',
    remark: 'Not Coming',
  }),

  // -- a blank row in the middle of the sheet -------------------------------
  BLANK,

  // -- family 3: two members, leading-0 mobile, "Not Sure", no Romm/bed ----
  // Arrival only; there is no departure at all for this family.
  toCells({
    u: 3,
    sr: 1,
    name: 'KIRAN SHAH',
    place: 'MUMBAI',
    contact: '094251 55093',
    pax: 2,
    arrDate: '4th ',
    arrTime: '10:30',
    arrMode: 'Flight',
    arrDetails: '6E 5074',
    pickUp: 'Ahmedabad T2',
    remark: 'Not Sure',
  }),
  toCells({ sr: 2, name: 'MEENA SHAH' }),

  // -- family 4: mobile as a bare number, PLACE and CONTACT both present ---
  toCells({
    u: 4,
    sr: 1,
    name: 'DHRUV DESAI',
    place: 'VADODARA',
    contact: 9876543210,
    pax: 1,
    arrDate: '5th',
    arrMode: 'Train',
    arrDetails: '12009',
    pickUp: 'Ahmedabad Jn',
  }),

  // -- family 5: blank PLACE and blank CONTACT, directly under family 4 ----
  // THE REGRESSION GUARD. If either field comes back as VADODARA or
  // 9876543210, a caller dials a stranger.
  toCells({ u: 5, sr: 1, name: 'HARSH JOSHI', pax: 1, arrDate: '6th' }),

  // -- family 6: a number that is not an Indian mobile ---------------------
  toCells({
    u: 6,
    sr: 1,
    name: 'NEHA IYER',
    place: 'LONDON',
    contact: '+1 415 555 0132',
    pax: 1,
    arrDate: '7th',
    arrMode: 'Flight',
  }),

  // -- an orphan: blank U AND blank SR.NO ----------------------------------
  // Nothing proves this row belongs to family 6. It must be reported, not
  // silently attached.
  toCells({ name: 'UNKNOWN PERSON' }),
]

const sheet = XLSX.utils.aoa_to_sheet(ROWS)
const book = XLSX.utils.book_new()
// "Sheet1" specifically: only Sheet1 carries Romm and bed. A second tab is
// added so the test can prove the reader picks Sheet1 by name rather than
// falling back to "the first sheet".
XLSX.utils.book_append_sheet(book, sheet, 'Sheet1')
XLSX.utils.book_append_sheet(
  book,
  XLSX.utils.aoa_to_sheet([['this tab exists only to prove Sheet1 is chosen by name']]),
  'Sheet7',
)

const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, buffer)

process.stdout.write(`wrote ${OUT} (${ROWS.length} rows incl. header)\n`)
