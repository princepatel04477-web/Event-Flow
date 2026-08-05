/**
 * Converts the small sample contact list (`evtflow_sample.xlsx`) into the
 * CALLING MASTER LIST workbook shape the app's import actually reads.
 *
 * The import screen (`/[eventCode]/import`) parses the KNOWN layout — the
 * `Sheet1` tab of CALLING MASTER LIST.xlsx: a "U" family-number column, an
 * SR.NO, a blank-headed Name column between SR.NO and PLACE, then PLACE /
 * CONTACT / ID / Romm / bed / Pax and the arrival+departure leg columns.
 *
 * Each sample row becomes one family (head row). Member rows are left out —
 * the sample has no member names to attach, and a blank member row would only
 * get reported as an orphan by `parseFamilies`.
 *
 * Usage:
 *   node scripts/build-master-from-sample.mjs <input.xlsx> [output.xlsx]
 */

import { readFileSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const HEADERS = [
  'U',
  'SR.NO',
  null, // Name column — blank header, located by position in the layout.
  'PLACE',
  'CONTACT',
  'ID',
  'Romm',
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

const inputPath = process.argv[2] ?? 'evtflow_sample.xlsx'
const outputPath = process.argv[3] ?? 'CALLING MASTER LIST (from sample).xlsx'

const wb = XLSX.read(readFileSync(inputPath), { type: 'buffer' })
const sheetName = wb.SheetNames[0]
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null })

// Locate the header row: the sample's "Name " / "Contact" / "City" row.
let headerRowIndex = rows.findIndex(
  (row) =>
    row &&
    row.some((c) => typeof c === 'string' && /name/i.test(c)) &&
    row.some((c) => typeof c === 'string' && /contact|phone|mobile/i.test(c)),
)
if (headerRowIndex < 0) {
  // No recognizable header — assume row 1.
  headerRowIndex = 0
}

const headers = rows[headerRowIndex] ?? []
const nameIdx = headers.findIndex((h) => h !== null && /name/i.test(String(h)))
const contactIdx = headers.findIndex((h) => h !== null && /contact|phone|mobile/i.test(String(h)))
const cityIdx = headers.findIndex((h) => h !== null && /city|place/i.test(String(h)))

if (nameIdx < 0 || contactIdx < 0) {
  throw new Error(
    `Could not find Name and Contact columns in "${sheetName}". ` +
      `Found headers: ${headers.map((h) => JSON.stringify(h)).join(', ')}`,
  )
}

const out = [HEADERS]

let familyNo = 0
for (let i = headerRowIndex + 1; i < rows.length; i++) {
  const row = rows[i]
  const name = row?.[nameIdx]
  const contact = row?.[contactIdx]
  const city = row?.[cityIdx]

  if (name === null || name === undefined || String(name).trim() === '') continue
  if (contact === null || contact === undefined || String(contact).trim() === '') continue

  familyNo += 1
  out.push([
    familyNo, // U
    familyNo, // SR.NO
    String(name).trim(), // Name
    city === null || city === undefined || String(city).trim() === ''
      ? null
      : String(city).trim(), // PLACE
    contact, // CONTACT — kept raw; normaliseMobile() in the parser handles it.
    null, // ID
    null, // Romm
    null, // bed
    1, // Pax — one name listed, so one person.
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
  ])
}

const outWb = XLSX.utils.book_new()
const outWs = XLSX.utils.aoa_to_sheet(out)
XLSX.utils.book_append_sheet(outWb, outWs, 'Sheet1')
// `XLSX.writeFile` resolves the path against its bundled fs shim, which can
// choke on spaces/parentheses on some platforms — write the buffer directly.
writeFileSync(outputPath, XLSX.write(outWb, { type: 'buffer', bookType: 'xlsx' }))

console.log(`Wrote ${familyNo} families to ${outputPath}`)
