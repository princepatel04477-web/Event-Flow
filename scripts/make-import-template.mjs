#!/usr/bin/env node
/**
 * Generates the guest-list template that ships with the app.
 *
 *     node scripts/make-import-template.mjs
 *     -> public/nuvent-guest-list-template.xlsx
 *
 * WHY THIS EXISTS. The import screen reads a sheet by FINDING a name column
 * and a number column (src/lib/import/contactsSheet.ts), or a full
 * CALLING_MASTER_LIST layout when the sheet is shaped that way. The common
 * case by far is the simple one: a list of guests, a name and a phone number.
 * The template therefore IS that simple list — two columns, filled so the
 * shape is obvious — rather than the twenty-column calling list, which is the
 * app's EXPORT, not something an operator should have to type by hand.
 *
 * The headers below are the literal spellings the contacts resolver accepts
 * ("Name", "Contact", "City"). Renaming them still works for anything on the
 * alias list in contactsSheet.ts, but these are the ones the template prints.
 *
 * The tab may be called anything — the importer no longer insists on "Sheet1"
 * — so the example tab is named for what it holds.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import * as XLSX from 'xlsx'

const OUT = 'public/nuvent-guest-list-template.xlsx'

// The simple shape: one guest per row. City is optional.
const HEADERS = ['Name', 'Contact', 'City']

const ROWS = [
  ['RAMESH SHARMA', '9876543210', 'SURAT'],
  ['SUNITA PATEL', '9123456780', 'BARODA'],
]

const NOTES = [
  ['HOW TO FILL THIS IN'],
  [''],
  ['One guest per row. That is the whole rule.'],
  [''],
  ['1. "Name" — the person you will phone. Required.'],
  [''],
  ['2. "Contact" — their phone number. 10 digits. Required.'],
  ['   +91, spaces and dashes are fine. A number stored by Excel as a'],
  ['   decimal is handled.'],
  [''],
  ['3. "City" — optional. It shows on the rooming list later.'],
  ['   Any further columns to the RIGHT are ignored.'],
  [''],
  ['4. The tab can be called anything. Add as many guests as you like.'],
  [''],
  ['NEED THE FULL FORMAT? The app already writes it for you. Export the guest'],
  ['list from the app (Guest Master), edit it in Excel, and upload it straight'],
  ['back — the importer reads the export as-is, travel legs and all.'],
  [''],
  ['NOTHING IS WRITTEN UNTIL YOU PRESS COMMIT. The import screen shows a full'],
  ['preview first: how many guests, every warning, and every row it could not'],
  ['read. Read that screen.'],
]

const wb = XLSX.utils.book_new()

const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...ROWS])
ws['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 16 }]
XLSX.utils.book_append_sheet(wb, ws, 'Guests')

const notes = XLSX.utils.aoa_to_sheet(NOTES)
notes['!cols'] = [{ wch: 76 }]
XLSX.utils.book_append_sheet(wb, notes, 'Instructions')

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
console.log(`wrote ${OUT}`)
