#!/usr/bin/env node
/**
 * Generates the import template workbook that ships with the app.
 *
 *     node scripts/make-import-template.mjs
 *     -> public/nuvent-guest-list-template.xlsx
 *
 * WHY THIS EXISTS. The importer resolves columns by EXACT match against a
 * short alias list — deliberately, because fuzzy matching a header wrong gives
 * every family someone else's phone number and nobody can see it happened.
 * The cost of that strictness is that a sheet built from imagination fails,
 * and the person who built it has already done the work by then.
 *
 * A template inverts that: the headers are correct before a single row is
 * typed. It is the cheapest possible fix for the most expensive failure.
 *
 * THE HEADERS BELOW ARE LOAD-BEARING. They are the literal strings
 * src/lib/import/layout.ts resolves, including the quirks:
 *   * the NAME column header is EMPTY — the layout finds it positionally, as
 *     the single column between SR.NO and PLACE. Do not label it.
 *   * "Romm" is the real spelling in the original sheet. "Room" also resolves.
 *   * Time / Mode / Details appear TWICE. Order matters: the first triple
 *     belongs to arrival, the second to departure.
 * Changing a header here without changing layout.ts breaks the template
 * silently — it will still open, and it will still fail to import.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import * as XLSX from 'xlsx'

const OUT = 'public/nuvent-guest-list-template.xlsx'

// Exactly the shape resolveKnownLayout() expects, in order.
const HEADERS = [
  'U', 'SR.NO', '', 'PLACE', 'CONTACT', 'ID', 'Romm', 'bed', 'Pax',
  'Arrival Date', 'Time', 'Mode', 'Details', 'Pick up', 'Remark',
  'Departure Date', 'Time', 'Mode', 'Details', 'Drop',
]

// Two example families. The second shows the continuation-row shape, which is
// the part people get wrong: a member row leaves U BLANK and continues SR.NO.
const ROWS = [
  [1, 1, 'RAMESH SHARMA', 'SURAT', 9876543210, '', '', '', 2,
   '22nd', '10:30', 'Train', '19004 / KHANDESH EXP', 'Surat Station', 'Bride side',
   '26th', '18:00', 'Train', '19003 / KHANDESH EXP', 'Surat Station'],
  ['', 2, 'SUNITA SHARMA', 'SURAT', '', '', '', '', '',
   '', '', '', '', '', '', '', '', '', '', ''],
  [2, 1, 'MOHAN PATEL', 'BARODA', 9123456780, '', '', '', 1,
   '23rd', '14:00', 'By Road', '', 'Hotel', 'Groom side',
   '25th', '09:00', 'By Road', '', 'Hotel'],
]

const NOTES = [
  ['HOW TO FILL THIS IN'],
  [''],
  ['1. Do not rename, reorder or delete any column on the "Sheet1" tab.'],
  ['   The third column header is INTENTIONALLY BLANK — that is the name'],
  ['   column. Leaving it blank is correct; labelling it breaks the import.'],
  [''],
  ['2. One family per U number. Put the number ONLY on the family\'s first'],
  ['   row (the person you will phone). Every other member of that family'],
  ['   leaves U BLANK and continues SR.NO: 1, 2, 3...'],
  [''],
  ['   A row with a blank U and an SR.NO that does not continue the sequence'],
  ['   is not imported. It is reported to you before anything is written —'],
  ['   nothing is dropped silently — but it does have to be fixed.'],
  [''],
  ['3. CONTACT goes on the family\'s first row. 10 digits. +91 and spaces are'],
  ['   fine. A number stored by Excel as a decimal is handled.'],
  [''],
  ['4. Pax is the TOTAL number of people in that family, including anyone'],
  ['   whose name you have not listed. If Pax is 5 and you have named 2, the'],
  ['   import tells you so — that is a question for the phone call, not an'],
  ['   error.'],
  [''],
  ['5. Dates can be written as 22nd, 22, or 22/08/2026. They are resolved'],
  ['   against the event dates set in the app. A date outside those dates is'],
  ['   kept as raw text rather than guessed into the wrong day.'],
  [''],
  ['6. Times: 10:30 or 10.30 AM. Mode: Train / Flight / By Road / Bus.'],
  [''],
  ['7. Blank rows are ignored. Extra columns to the RIGHT are ignored.'],
  [''],
  ['NOTHING IS WRITTEN UNTIL YOU PRESS COMMIT. The import screen shows a full'],
  ['preview first: how many families, how many guests, every warning, and'],
  ['every row it could not place. Read that screen.'],
]

const wb = XLSX.utils.book_new()

const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...ROWS])
ws['!cols'] = HEADERS.map((h) => ({ wch: Math.max(10, Math.min(22, (h || 'Name').length + 6)) }))
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')

const notes = XLSX.utils.aoa_to_sheet(NOTES)
notes['!cols'] = [{ wch: 76 }]
XLSX.utils.book_append_sheet(wb, notes, 'Instructions')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log(`wrote ${OUT}`)
