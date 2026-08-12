/**
 * Hotel sheet parser — pure, no DOM, no SheetJS, no Supabase.
 *
 * Reads a CSV or Excel workbook into a list of hotel-room rows with validation.
 * Every parser decision is reversible from the code alone — no guessing.
 */
import * as XLSX from 'xlsx'

export interface HotelRoomRow {
  rowNumber: number
  hotelName: string
  roomNumber: string
  roomType: string | null
  floor: string | null
  capacity: number | null
  notes: string | null
  contactPerson: string | null
  contactNumber: string | null
  hotelAddress: string | null
}

export interface HotelParseSuccess {
  ok: true
  headers: string[]
  rows: HotelRoomRow[]
  warnings: { rowNumber: number; message: string }[]
}

export interface HotelParseError {
  ok: false
  error: string
}

export type HotelParseResult = HotelParseSuccess | HotelParseError

/**
 * Column aliases accepted by the parser. Case-insensitive, whitespace-trimmed.
 * First match wins for each column.
 */
const COLUMN_ALIASES: Record<string, string[]> = {
  hotelName: ['hotel name', 'hotel', 'hotel name'],
  roomNumber: ['room number', 'room no', 'room #', 'room'],
  roomType: ['room type', 'type'],
  floor: ['floor'],
  capacity: ['capacity (pax)', 'capacity', 'pax', 'beds'],
  notes: ['notes', 'remarks'],
  contactPerson: ['contact person', 'contact name', 'manager'],
  contactNumber: ['contact number', 'contact no', 'contact mobile', 'contact phone'],
  hotelAddress: ['hotel address', 'address'],
}

function normHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, ' ')
}

function findColumn(
  key: string,
  headers: string[],
): { idx: number; header: string } | null {
  const aliases = COLUMN_ALIASES[key] ?? [key]
  for (const alias of aliases) {
    for (let i = 0; i < headers.length; i++) {
      if (normHeader(headers[i] ?? '') === alias) {
        return { idx: i, header: headers[i] ?? '' }
      }
    }
  }
  return null
}

function parseCapacity(raw: string | null): number | null {
  if (!raw || raw.trim() === '') return null
  const n = Number(raw.trim())
  if (Number.isFinite(n) && n > 0) return Math.round(n)
  return null
}

function isEmptyRow(cells: unknown[]): boolean {
  return cells.every((c) => c === null || c === undefined || String(c).trim() === '')
}

/**
 * Parse a CSV or XLSX file into hotel-room rows.
 */
export async function parseHotelWorkbook(file: File): Promise<HotelParseResult> {
  try {
    const text = await file.text()
    const rows: string[][] = []

    // Try CSV first
    if (file.name.endsWith('.csv') || !file.name.match(/\.xlsx?$/i)) {
      const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '')
      if (lines.length === 0) return { ok: false, error: 'The file is empty.' }
      for (const line of lines) {
        // Simple CSV parser — handles quoted fields
        const cells: string[] = []
        let current = ''
        let inQuotes = false
        for (let i = 0; i < line.length; i++) {
          const ch = line[i]
          if (inQuotes) {
            if (ch === '"') {
              if (line[i + 1] === '"') { current += '"'; i++ }
              else inQuotes = false
            } else {
              current += ch
            }
          } else {
            if (ch === '"') { inQuotes = true }
            else if (ch === ',') { cells.push(current.trim()); current = '' }
            else { current += ch }
          }
        }
        cells.push(current.trim())
        rows.push(cells)
      }
    } else {
      // XLSX
      const buffer = await file.arrayBuffer()
      const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
      const sheetName = wb.SheetNames[0]
      if (!sheetName) return { ok: false, error: 'The workbook has no sheets.' }
      const grid = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheetName], {
        header: 1,
        raw: true,
        defval: '',
        blankrows: false,
      })
      for (const row of grid) {
        if (row && row.length > 0) {
          rows.push(row.map((c) => (c == null ? '' : String(c))))
        }
      }
    }

    if (rows.length === 0) return { ok: false, error: 'The file is empty.' }

    const headerRow = rows[0]
    if (!headerRow || headerRow.length === 0) {
      return { ok: false, error: 'Could not find a header row.' }
    }

    // Required columns
    const hotelCol = findColumn('hotelName', headerRow)
    if (!hotelCol) {
      return {
        ok: false,
        error: `Missing required column: "Hotel Name". Found headers: ${headerRow.filter(Boolean).join(', ')}. ` +
               'Download the template and match its columns exactly.',
      }
    }

    const required = ['roomNumber']
    for (const key of required) {
      if (!findColumn(key, headerRow)) {
        return {
          ok: false,
          error: `Missing required column: "${COLUMN_ALIASES[key]?.[0] ?? key}". Found headers: ${headerRow.filter(Boolean).join(', ')}.`,
        }
      }
    }

    const roomCol = findColumn('roomNumber', headerRow)!
    const typeCol = findColumn('roomType', headerRow)
    const floorCol = findColumn('floor', headerRow)
    const capCol = findColumn('capacity', headerRow)
    const notesCol = findColumn('notes', headerRow)
    const contactPersonCol = findColumn('contactPerson', headerRow)
    const contactNumberCol = findColumn('contactNumber', headerRow)
    const addressCol = findColumn('hotelAddress', headerRow)

    const outRows: HotelRoomRow[] = []
    const warnings: { rowNumber: number; message: string }[] = []

    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]
      if (!cells || isEmptyRow(cells)) continue

      const rowNum = i + 1 // 1-based, header is row 1
      const hotelName = (cells[hotelCol.idx] ?? '').trim()
      if (!hotelName) {
        warnings.push({ rowNumber: rowNum, message: 'Row skipped: blank hotel name.' })
        continue
      }

      const roomNumber = (cells[roomCol.idx] ?? '').trim()
      if (!roomNumber) {
        warnings.push({ rowNumber: rowNum, message: 'Row skipped: blank room number.' })
        continue
      }

      const get = (col: { idx: number } | null): string | null => {
        if (!col) return null
        const v = (cells[col.idx] ?? '').trim()
        return v === '' ? null : v
      }

      const capRaw = get(capCol)
      const cap = parseCapacity(capRaw)
      if (capRaw !== null && cap === null) {
        warnings.push({
          rowNumber: rowNum,
          message: `Capacity '${capRaw}' is not a number — treating as blank.`,
        })
      }

      outRows.push({
        rowNumber: rowNum,
        hotelName,
        roomNumber,
        roomType: get(typeCol),
        floor: get(floorCol),
        capacity: cap,
        notes: get(notesCol),
        contactPerson: get(contactPersonCol),
        contactNumber: get(contactNumberCol),
        hotelAddress: get(addressCol),
      })
    }

    return {
      ok: true,
      headers: headerRow.filter(Boolean),
      rows: outRows,
      warnings,
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Could not read the file.',
    }
  }
}
