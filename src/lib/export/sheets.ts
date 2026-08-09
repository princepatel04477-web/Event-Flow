/**
 * Export data assembly — fetch everything the 5 sheets need, then hand it
 * to `buildWorkbook` as declarative sheet definitions.
 *
 * Runs server-side (server action) so the export works from any browser
 * without a round-trip through the client's own data. The workbook itself
 * is built client-side from the returned rows (SheetJS in the browser), per
 * the task: "Generate client-side with SheetJS so it works without a server
 * round-trip." The server action here is the data source; the browser turns
 * rows into the .xlsx download.
 *
 * Every timestamp that reaches a sheet is already server-stamped (all the
 * source columns — recorded_at, created_at, updated_at — are DB defaults).
 */
import type { Database } from '@/lib/supabase/database.types'

export type GuestGroupRow = Database['public']['Tables']['guest_groups']['Row']
export type TravelLegRow = Database['public']['Tables']['travel_legs']['Row']
export type DeliverableRow = Database['public']['Tables']['deliverables']['Row']
export type DeliveryProofRow = Database['public']['Tables']['delivery_proofs']['Row']
export type RoomAssignmentRow = Database['public']['Tables']['room_assignments']['Row']
export type RoomRow = Database['public']['Tables']['rooms']['Row']
export type HotelRow = Database['public']['Tables']['hotels']['Row']

// ---------------------------------------------------------------------------
// Sheet row shapes
// ---------------------------------------------------------------------------

export interface GuestMasterRow {
  _id: string
  u: string
  srNo: string
  name: string
  place: string
  contact: string
  pax: number
  arrivalDate: string
  arrivalTime: string
  arrivalMode: string
  arrivalDetails: string
  pickUp: string
  remark: string
  departureDate: string
  departureTime: string
  departureMode: string
  departureDetails: string
  drop: string
}

export interface FamilyHeadRow {
  _id: string
  headName: string
  groupType: string
  side: string
  city: string
  phone: string
  adults: number | null
  children: number | null
  expectedPax: number
  rsvpStatus: string
  priority: number
  room: string
  arrival: string
  departure: string
}

export interface RoomAllocationRow {
  hotel: string
  roomNumber: string
  roomType: string
  headName: string
  checkInDate: Date | null
  checkInTime: string | null
  checkOutDate: Date | null
  checkOutTime: string | null
  released: string
}

export interface DeliverableRowExport {
  headName: string
  kind: string
  itemName: string
  quantity: number
  status: string
  deliveredAt: string | null
  deliveredBy: string | null
}

export interface ExceptionRow {
  headName: string
  phone: string
  issue: string
  detail: string
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

export interface ExportData {
  groups: GuestGroupRow[]
  legs: TravelLegRow[]
  deliverables: DeliverableRow[]
  proofs: DeliveryProofRow[]
  assignments: RoomAssignmentRow[]
  rooms: RoomRow[]
  hotels: HotelRow[]
  /** profiles keyed by user id -> display name, for "delivered by". */
  profileNames: Record<string, string>
  /** staff members keyed by id -> name, for code-auth proof attribution. */
  staffNames: Record<string, string>
}

/** Sanitised event name for the filename (no path / illegal chars). */
export function safeFileNamePart(name: string | null): string {
  const clean = (name ?? 'event')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .trim()
  return clean || 'event'
}

// ---------------------------------------------------------------------------
// Sheet builders — pure: take ExportData + event dates, return definitions.
// ---------------------------------------------------------------------------

const RSVP_STATUS_LABELS: Record<string, string> = {
  not_started: 'Not started',
  attempted: 'Attempted',
  callback: 'Callback',
  tentative: 'Tentative',
  confirmed: 'Confirmed',
  declined: 'Declined',
  unreachable: 'Unreachable',
}

const SIDE_LABELS: Record<string, string> = {
  bride: 'Bride',
  groom: 'Groom',
  both: 'Both',
  other: 'Other',
}

const TRAVEL_MODE_LABELS: Record<string, string> = {
  air: 'Air',
  train: 'Train',
  bus: 'Bus',
  cab: 'Cab',
  self_drive: 'Self-drive',
}

function legCell(leg: TravelLegRow | undefined): string {
  if (!leg) return ''
  const parts = [
    leg.travel_date ?? '',
    leg.travel_time ? leg.travel_time.slice(0, 5) : '',
    leg.mode ? TRAVEL_MODE_LABELS[leg.mode] ?? leg.mode : '',
    leg.reference ?? '',
    leg.point ?? '',
  ].filter(Boolean)
  return parts.join(' ')
}

export function buildGuestMasterRows(data: ExportData): GuestMasterRow[] {
  return data.groups.map((g) => {
    const arrival = data.legs.find((l) => l.group_id === g.id && l.direction === 'arrival')
    const departure = data.legs.find((l) => l.group_id === g.id && l.direction === 'departure')
    return {
      _id: g.id,
      u: g.group_code ?? '',
      srNo: g.group_code ?? '',
      name: g.head_name,
      place: g.city ?? '',
      contact: g.primary_mobile ?? '',
      pax: g.expected_pax,
      arrivalDate: arrival?.travel_date ?? '',
      arrivalTime: arrival?.travel_time ? arrival.travel_time.slice(0, 5) : '',
      arrivalMode: arrival?.mode ? TRAVEL_MODE_LABELS[arrival.mode] ?? arrival.mode : '',
      arrivalDetails: arrival?.reference ?? '',
      pickUp: arrival?.point ?? '',
      remark: g.remarks ?? '',
      departureDate: departure?.travel_date ?? '',
      departureTime: departure?.travel_time ? departure.travel_time.slice(0, 5) : '',
      departureMode: departure?.mode ? TRAVEL_MODE_LABELS[departure.mode] ?? departure.mode : '',
      departureDetails: departure?.reference ?? '',
      drop: departure?.point ?? '',
    }
  })
}

export function buildFamilyHeadRows(data: ExportData): FamilyHeadRow[] {
  const roomByGroup = new Map<string, string>()
  for (const a of data.assignments) {
    if (a.released_at !== null) continue
    const room = data.rooms.find((r) => r.id === a.room_id)
    const hotel = room ? data.hotels.find((h) => h.id === room.hotel_id) : undefined
    const label = room ? [hotel?.name, room.room_number].filter(Boolean).join(' ') : ''
    if (label) roomByGroup.set(a.group_id, label)
  }

  return data.groups.map((g) => {
    const arrival = data.legs.find((l) => l.group_id === g.id && l.direction === 'arrival')
    const departure = data.legs.find((l) => l.group_id === g.id && l.direction === 'departure')
    return {
      _id: g.id,
      headName: g.head_name,
      groupType: g.group_type,
      side: g.side ? SIDE_LABELS[g.side] ?? g.side : '',
      city: g.city ?? '',
      phone: g.primary_mobile ?? '',
      adults: g.adults_confirmed,
      children: g.children_confirmed,
      expectedPax: g.expected_pax,
      rsvpStatus: RSVP_STATUS_LABELS[g.rsvp_status] ?? g.rsvp_status,
      priority: g.priority,
      room: roomByGroup.get(g.id) ?? '',
      arrival: legCell(arrival),
      departure: legCell(departure),
    }
  })
}

export function buildRoomAllocationRows(data: ExportData): RoomAllocationRow[] {
  const roomById = new Map(data.rooms.map((r) => [r.id, r]))
  const hotelById = new Map(data.hotels.map((h) => [h.id, h]))
  const groupById = new Map(data.groups.map((g) => [g.id, g]))

  return data.assignments
    .filter((a) => a.released_at === null)
    .map((a) => {
      const room = roomById.get(a.room_id)
      const hotel = room ? hotelById.get(room.hotel_id) : undefined
      const group = groupById.get(a.group_id)
      return {
        hotel: hotel?.name ?? '',
        roomNumber: room?.room_number ?? '',
        roomType: room?.room_type ?? '',
        headName: group?.head_name ?? '',
        checkInDate: a.check_in_date ? parseDate(a.check_in_date) : null,
        checkInTime: a.check_in_time ?? null,
        checkOutDate: a.check_out_date ? parseDate(a.check_out_date) : null,
        checkOutTime: a.check_out_time ?? null,
        released: '',
      }
    })
}

export function buildDeliverableRows(data: ExportData): DeliverableRowExport[] {
  const groupById = new Map(data.groups.map((g) => [g.id, g]))

  // The delivery timestamp and who delivered it live on the delivery_proofs
  // row (insert-only, one per confirmed delivery). Map each deliverable to
  // its latest proof.
  const proofByDeliverable = new Map<string, DeliveryProofRow>()
  for (const p of data.proofs) {
    const existing = proofByDeliverable.get(p.deliverable_id)
    if (!existing || p.recorded_at > existing.recorded_at) {
      proofByDeliverable.set(p.deliverable_id, p)
    }
  }

  return data.deliverables.map((d) => {
    const proof = proofByDeliverable.get(d.id)
    return {
      headName: groupById.get(d.group_id)?.head_name ?? '',
      kind: d.kind === 'hamper' ? 'Hamper' : 'Return gift',
      itemName: d.item_name ?? '',
      quantity: d.quantity,
      status: d.status,
      deliveredAt: proof?.recorded_at ?? null,
      deliveredBy: proof
        ? (proof.captured_by_staff
            ? data.staffNames[proof.captured_by_staff]
            : proof.captured_by
              ? data.profileNames[proof.captured_by] ?? null
              : null) ?? null
        : null,
    }
  })
}

export function buildExceptionRows(data: ExportData): ExceptionRow[] {
  const exceptions: ExceptionRow[] = []

  // Each row's issue list. The room map mirrors buildFamilyHeadRows.
  const roomByGroup = new Map<string, string>()
  for (const a of data.assignments) {
    if (a.released_at !== null) continue
    const room = data.rooms.find((r) => r.id === a.room_id)
    const hotel = room ? data.hotels.find((h) => h.id === room.hotel_id) : undefined
    const label = room ? [hotel?.name, room.room_number].filter(Boolean).join(' ') : ''
    if (label) roomByGroup.set(a.group_id, label)
  }
  const deliveredHamper = new Map<string, boolean>()
  const deliveredReturnGift = new Map<string, boolean>()
  for (const d of data.deliverables) {
    if (d.status === 'delivered') {
      if (d.kind === 'hamper') deliveredHamper.set(d.group_id, true)
      else deliveredReturnGift.set(d.group_id, true)
    }
  }

  for (const g of data.groups) {
    const issues: string[] = []
    const arrival = data.legs.find((l) => l.group_id === g.id && l.direction === 'arrival')
    const departure = data.legs.find((l) => l.group_id === g.id && l.direction === 'departure')

    if (!arrival?.travel_date || !arrival.travel_time) {
      issues.push('Missing arrival details')
    }
    if (!departure?.travel_date || !departure.travel_time) {
      issues.push('Missing departure details')
    }
    if (g.rsvp_status !== 'confirmed') {
      issues.push('RSVP not confirmed')
    }
    if (!roomByGroup.has(g.id)) {
      issues.push('No room allocated')
    }
    if (g.needs_return_gift && !deliveredReturnGift.get(g.id)) {
      issues.push('Return gift undelivered')
    }
    if (!deliveredHamper.get(g.id)) {
      issues.push('Hamper undelivered')
    }
    // adults + children disagreeing with the named-member count: the head
    // row's guests table has exactly one head; the Excel "Pax" is
    // expected_pax. Compare confirmed counts against the sheet's own pax.
    if (
      g.adults_confirmed !== null &&
      g.children_confirmed !== null &&
      g.expected_pax !== null &&
      g.adults_confirmed + g.children_confirmed !== g.expected_pax
    ) {
      issues.push('Adults + children disagree with pax')
    }

    if (issues.length === 0) continue

    exceptions.push({
      headName: g.head_name,
      phone: g.primary_mobile ?? '',
      issue: issues.join(', '),
      detail: `${g.city ?? ''}${g.group_code ? ` · family ${g.group_code}` : ''}`.trim(),
    })
  }

  return exceptions
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** "YYYY-MM-DD" -> a local-midnight Date (the export writes it as a date cell). */
function parseDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1)
}
