/**
 * Building the Excel export workbook.
 *
 * Pure and dependency-free apart from SheetJS itself: no Supabase, no React,
 * no `server-only`. The page fetches rows and hands them here; this module
 * decides what a sheet looks like. That split is what makes the column specs
 * below unit-testable without a browser or a database.
 *
 * Three formatting rules are load-bearing, not cosmetic:
 *
 *  1. Mobiles are TEXT cells. Excel reads a bare 9876543210 as a number,
 *     drops nothing visibly, then re-exports it as 9.87654E+09 — and a
 *     leading zero on a landline vanishes outright. This is the same mess
 *     the importer already has to clean up; the exporter must not create it.
 *  2. Dates are written DD/MM/YYYY as text. A real date cell would be
 *     rendered by Excel in the *reader's* locale, so the same file shows
 *     12/07 in Ahmedabad and 07/12 in a US-locale laptop. For a sheet whose
 *     entire job is telling a driver which day to turn up, an unambiguous
 *     fixed rendering beats a sortable one.
 *  3. Ids travel in hidden columns. That is what lets an edited sheet come
 *     back in and match instead of duplicating.
 */

import * as XLSX from 'xlsx'

// ---------------------------------------------------------------------
// Row shapes the page supplies
// ---------------------------------------------------------------------

export interface ExportGroup {
  id: string
  group_code: string | null
  head_name: string
  primary_mobile: string | null
  alt_mobile: string | null
  side: string | null
  group_type: string | null
  city: string | null
  expected_pax: number
  confirmed_pax: number | null
  rsvp_status: string
  needs_return_gift: boolean
  remarks: string | null
}

export interface ExportGuest {
  id: string
  group_id: string
  full_name: string
  mobile: string | null
  is_head: boolean
  age_band: string
  notes: string | null
}

export interface ExportLeg {
  group_id: string
  direction: string
  mode: string | null
  travel_date: string | null
  travel_time: string | null
  reference: string | null
  point: string | null
  pax_on_leg: number | null
  needs_transport: boolean
  notes: string | null
}

export interface ExportRoom {
  guest_id: string
  group_id: string
  hotel_name: string | null
  room_number: string | null
  check_in_date: string | null
  check_out_date: string | null
}

export interface ExportDeliverable {
  group_id: string
  guest_id: string | null
  kind: string
  status: string
}

export interface ExportData {
  groups: ExportGroup[]
  guests: ExportGuest[]
  legs: ExportLeg[]
  rooms: ExportRoom[]
  deliverables: ExportDeliverable[]
}

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/

/** Postgres `date` (YYYY-MM-DD) → "DD/MM/YYYY". Empty for null/garbage. */
export function excelDate(value: string | null | undefined): string {
  if (!value) return ''
  const m = DATE_ONLY.exec(value)
  if (!m) return ''
  return `${m[3]}/${m[2]}/${m[1]}`
}

/** Postgres `time` ("HH:MM:SS") → "HH:MM". */
export function excelTime(value: string | null | undefined): string {
  if (!value) return ''
  return value.length >= 5 ? value.slice(0, 5) : value
}

/** Enum code → the words used on screen: `self_drive` → "Self drive". */
export function humanise(value: string | null | undefined): string {
  if (!value) return ''
  const spaced = value.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function yesNo(value: boolean | null | undefined): string {
  return value ? 'Yes' : 'No'
}

// ---------------------------------------------------------------------
// Column specs
// ---------------------------------------------------------------------

export interface Column<T> {
  header: string
  value: (row: T) => string | number | null
  /** Carried for re-import, never shown. */
  hidden?: boolean
  /** Force a text cell even when the value looks numeric. */
  text?: boolean
  width?: number
}

/**
 * Build a worksheet from a column spec.
 *
 * Cells are written individually rather than via `json_to_sheet` so that a
 * mobile number can be pinned to `t: 's'` with an explicit `@` (text) number
 * format. Left to infer, SheetJS would type a numeric-looking string as a
 * number and hand Excel exactly the float it must never see.
 */
export function sheetFromColumns<T>(columns: Column<T>[], rows: T[]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {}

  columns.forEach((column, c) => {
    sheet[XLSX.utils.encode_cell({ r: 0, c })] = { t: 's', v: column.header }
  })

  rows.forEach((row, i) => {
    const r = i + 1
    columns.forEach((column, c) => {
      const raw = column.value(row)
      if (raw === null || raw === undefined || raw === '') return

      const address = XLSX.utils.encode_cell({ r, c })
      if (typeof raw === 'number' && !column.text) {
        sheet[address] = { t: 'n', v: raw }
      } else {
        // `z: '@'` is the text format. Without it Excel offers to "convert to
        // number" on open, and a helpful user clicking yes re-breaks mobiles.
        sheet[address] = { t: 's', v: String(raw), z: '@' }
      }
    })
  })

  sheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: Math.max(rows.length, 1), c: Math.max(columns.length - 1, 0) },
  })
  sheet['!cols'] = columns.map((column) => ({
    hidden: column.hidden ?? false,
    wch: column.width ?? 16,
  }))
  // Freeze the header row — 238 families is a lot of scrolling otherwise.
  sheet['!freeze'] = 'A2'

  return sheet
}

// ---------------------------------------------------------------------
// Derived lookups
// ---------------------------------------------------------------------

interface Lookups {
  groupById: Map<string, ExportGroup>
  legFor: (groupId: string, direction: string) => ExportLeg | undefined
  roomFor: (guestId: string) => ExportRoom | undefined
  deliverableFor: (groupId: string, guestId: string | null, kind: string) => string
}

function buildLookups(data: ExportData): Lookups {
  const groupById = new Map(data.groups.map((g) => [g.id, g]))

  const legs = new Map<string, ExportLeg>()
  for (const leg of data.legs) {
    // Oldest wins, matching apply_rsvp_extraction(), which only ever edits
    // the first leg per direction. The sheet must show the row the app edits.
    const key = `${leg.group_id}:${leg.direction}`
    if (!legs.has(key)) legs.set(key, leg)
  }

  const rooms = new Map(data.rooms.map((r) => [r.guest_id, r]))

  const deliverables = new Map<string, string>()
  for (const d of data.deliverables) {
    deliverables.set(`${d.group_id}:${d.guest_id ?? ''}:${d.kind}`, d.status)
  }

  return {
    groupById,
    legFor: (groupId, direction) => legs.get(`${groupId}:${direction}`),
    roomFor: (guestId) => rooms.get(guestId),
    deliverableFor: (groupId, guestId, kind) =>
      // A per-guest deliverable wins over the group-level one; falling back to
      // the group row is what makes a family hamper show against every member.
      deliverables.get(`${groupId}:${guestId ?? ''}:${kind}`) ??
      deliverables.get(`${groupId}::${kind}`) ??
      '',
  }
}

// ---------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------

export interface GuestRow {
  guest: ExportGuest
  group: ExportGroup
  arrival: ExportLeg | undefined
  departure: ExportLeg | undefined
  room: ExportRoom | undefined
  hamper: string
  returnGift: string
}

export function guestColumns(): Column<GuestRow>[] {
  return [
    { header: 'group_id', value: (r) => r.group.id, hidden: true, text: true },
    { header: 'guest_id', value: (r) => r.guest.id, hidden: true, text: true },
    { header: 'Family head', value: (r) => r.group.head_name, width: 24 },
    { header: 'Guest name', value: (r) => r.guest.full_name, width: 24 },
    { header: 'Head of family', value: (r) => yesNo(r.guest.is_head), width: 12 },
    { header: 'Age band', value: (r) => humanise(r.guest.age_band), width: 10 },
    { header: 'Mobile', value: (r) => r.guest.mobile ?? r.group.primary_mobile, text: true },
    { header: 'Side', value: (r) => humanise(r.group.side), width: 10 },
    { header: 'RSVP status', value: (r) => humanise(r.group.rsvp_status), width: 14 },
    { header: 'Expected pax', value: (r) => r.group.expected_pax, width: 12 },
    { header: 'Confirmed pax', value: (r) => r.group.confirmed_pax, width: 12 },
    { header: 'Arrival mode', value: (r) => humanise(r.arrival?.mode), width: 12 },
    { header: 'Arrival date', value: (r) => excelDate(r.arrival?.travel_date), text: true },
    { header: 'Arrival time', value: (r) => excelTime(r.arrival?.travel_time), text: true },
    { header: 'Arrival reference', value: (r) => r.arrival?.reference ?? '', text: true },
    { header: 'Arrival point', value: (r) => r.arrival?.point ?? '', width: 20 },
    { header: 'Departure mode', value: (r) => humanise(r.departure?.mode), width: 12 },
    { header: 'Departure date', value: (r) => excelDate(r.departure?.travel_date), text: true },
    { header: 'Departure time', value: (r) => excelTime(r.departure?.travel_time), text: true },
    { header: 'Departure reference', value: (r) => r.departure?.reference ?? '', text: true },
    { header: 'Departure point', value: (r) => r.departure?.point ?? '', width: 20 },
    { header: 'Hotel', value: (r) => r.room?.hotel_name ?? '', width: 20 },
    { header: 'Room', value: (r) => r.room?.room_number ?? '', text: true, width: 10 },
    { header: 'Check in', value: (r) => excelDate(r.room?.check_in_date), text: true },
    { header: 'Check out', value: (r) => excelDate(r.room?.check_out_date), text: true },
    { header: 'Hamper', value: (r) => humanise(r.hamper), width: 12 },
    { header: 'Return gift', value: (r) => humanise(r.returnGift), width: 12 },
    { header: 'Remarks', value: (r) => r.group.remarks ?? '', width: 30 },
  ]
}

export function buildGuestRows(data: ExportData, lookups: Lookups): GuestRow[] {
  return data.guests
    .map((guest) => {
      const group = lookups.groupById.get(guest.group_id)
      if (!group) return null
      return {
        guest,
        group,
        arrival: lookups.legFor(group.id, 'arrival'),
        departure: lookups.legFor(group.id, 'departure'),
        room: lookups.roomFor(guest.id),
        hamper: lookups.deliverableFor(group.id, guest.id, 'hamper'),
        returnGift: lookups.deliverableFor(group.id, guest.id, 'return_gift'),
      }
    })
    .filter((r): r is GuestRow => r !== null)
    .sort(
      (a, b) =>
        a.group.head_name.localeCompare(b.group.head_name) ||
        // Head of the family first within each group, then alphabetical.
        Number(b.guest.is_head) - Number(a.guest.is_head) ||
        a.guest.full_name.localeCompare(b.guest.full_name),
    )
}

export interface FamilyRow {
  group: ExportGroup
  guestCount: number
  arrival: ExportLeg | undefined
  departure: ExportLeg | undefined
}

export function familyColumns(): Column<FamilyRow>[] {
  return [
    { header: 'group_id', value: (r) => r.group.id, hidden: true, text: true },
    { header: 'Group code', value: (r) => r.group.group_code ?? '', text: true, width: 12 },
    { header: 'Family head', value: (r) => r.group.head_name, width: 24 },
    { header: 'Mobile', value: (r) => r.group.primary_mobile, text: true },
    { header: 'Alt mobile', value: (r) => r.group.alt_mobile, text: true },
    { header: 'City', value: (r) => r.group.city ?? '', width: 16 },
    { header: 'Side', value: (r) => humanise(r.group.side), width: 10 },
    { header: 'Type', value: (r) => humanise(r.group.group_type), width: 12 },
    { header: 'RSVP status', value: (r) => humanise(r.group.rsvp_status), width: 14 },
    { header: 'Expected pax', value: (r) => r.group.expected_pax, width: 12 },
    { header: 'Confirmed pax', value: (r) => r.group.confirmed_pax, width: 12 },
    { header: 'Names on file', value: (r) => r.guestCount, width: 12 },
    { header: 'Arrival date', value: (r) => excelDate(r.arrival?.travel_date), text: true },
    { header: 'Arrival time', value: (r) => excelTime(r.arrival?.travel_time), text: true },
    { header: 'Departure date', value: (r) => excelDate(r.departure?.travel_date), text: true },
    { header: 'Departure time', value: (r) => excelTime(r.departure?.travel_time), text: true },
    { header: 'Needs return gift', value: (r) => yesNo(r.group.needs_return_gift), width: 14 },
    { header: 'Remarks', value: (r) => r.group.remarks ?? '', width: 30 },
  ]
}

export function buildFamilyRows(data: ExportData, lookups: Lookups): FamilyRow[] {
  const counts = new Map<string, number>()
  for (const guest of data.guests) {
    counts.set(guest.group_id, (counts.get(guest.group_id) ?? 0) + 1)
  }

  return data.groups
    .map((group) => ({
      group,
      guestCount: counts.get(group.id) ?? 0,
      arrival: lookups.legFor(group.id, 'arrival'),
      departure: lookups.legFor(group.id, 'departure'),
    }))
    .sort((a, b) => a.group.head_name.localeCompare(b.group.head_name))
}

export interface TravelRow {
  leg: ExportLeg
  group: ExportGroup
}

export function travelColumns(): Column<TravelRow>[] {
  return [
    { header: 'group_id', value: (r) => r.group.id, hidden: true, text: true },
    { header: 'Date', value: (r) => excelDate(r.leg.travel_date), text: true },
    { header: 'Time', value: (r) => excelTime(r.leg.travel_time), text: true },
    { header: 'Family head', value: (r) => r.group.head_name, width: 24 },
    { header: 'Mobile', value: (r) => r.group.primary_mobile, text: true },
    { header: 'Mode', value: (r) => humanise(r.leg.mode), width: 12 },
    { header: 'Reference', value: (r) => r.leg.reference ?? '', text: true },
    { header: 'Point', value: (r) => r.leg.point ?? '', width: 22 },
    {
      header: 'Pax',
      value: (r) => r.leg.pax_on_leg ?? r.group.confirmed_pax ?? r.group.expected_pax,
      width: 8,
    },
    { header: 'Needs transport', value: (r) => yesNo(r.leg.needs_transport), width: 14 },
    { header: 'RSVP status', value: (r) => humanise(r.group.rsvp_status), width: 14 },
    { header: 'Notes', value: (r) => r.leg.notes ?? r.group.remarks ?? '', width: 30 },
  ]
}

/**
 * All legs in one direction, ordered for the logistics desk: by day, then by
 * clock. Legs with no date sort last — they are the ones still to chase, and
 * burying them mid-list hides them.
 */
export function buildTravelRows(
  data: ExportData,
  lookups: Lookups,
  direction: 'arrival' | 'departure',
): TravelRow[] {
  return data.legs
    .filter((leg) => leg.direction === direction)
    .map((leg) => {
      const group = lookups.groupById.get(leg.group_id)
      return group ? { leg, group } : null
    })
    .filter((r): r is TravelRow => r !== null)
    .sort((a, b) => {
      const dateA = a.leg.travel_date ?? '9999-12-31'
      const dateB = b.leg.travel_date ?? '9999-12-31'
      if (dateA !== dateB) return dateA < dateB ? -1 : 1
      const timeA = a.leg.travel_time ?? '99:99'
      const timeB = b.leg.travel_time ?? '99:99'
      if (timeA !== timeB) return timeA < timeB ? -1 : 1
      return a.group.head_name.localeCompare(b.group.head_name)
    })
}

// ---------------------------------------------------------------------
// Workbook
// ---------------------------------------------------------------------

export const SHEET_NAMES = ['Guests', 'Families', 'Arrivals', 'Departures'] as const
export type SheetName = (typeof SHEET_NAMES)[number]

/** Build all four sheets. `only` narrows the book to a single sheet. */
export function buildWorkbook(data: ExportData, only?: SheetName): XLSX.WorkBook {
  const lookups = buildLookups(data)
  const book = XLSX.utils.book_new()

  const sheets: Record<SheetName, () => XLSX.WorkSheet> = {
    Guests: () => sheetFromColumns(guestColumns(), buildGuestRows(data, lookups)),
    Families: () => sheetFromColumns(familyColumns(), buildFamilyRows(data, lookups)),
    Arrivals: () =>
      sheetFromColumns(travelColumns(), buildTravelRows(data, lookups, 'arrival')),
    Departures: () =>
      sheetFromColumns(travelColumns(), buildTravelRows(data, lookups, 'departure')),
  }

  for (const name of SHEET_NAMES) {
    if (only && name !== only) continue
    XLSX.utils.book_append_sheet(book, sheets[name](), name)
  }

  return book
}

/**
 * `{event_code}_{sheet}_{YYYY-MM-DD_HHmm}.xlsx`.
 *
 * The team will generate these several times a day, and two files called
 * "export.xlsx" in a Downloads folder is how the wrong list reaches a driver.
 * Local time on purpose: the timestamp is read by people standing in the same
 * room as the clock they compared it against.
 */
export function exportFilename(eventCode: string, sheet: string, when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `_${pad(when.getHours())}${pad(when.getMinutes())}`

  const safe = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '') || 'export'
  return `${safe(eventCode)}_${safe(sheet)}_${stamp}.xlsx`
}
