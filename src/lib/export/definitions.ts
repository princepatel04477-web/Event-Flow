/**
 * The five sheet definitions, assembled from export data. This is the
 * "adding a sheet is data, not code" layer: every column is a config object
 * with its header, type, width and value extractor.
 */
import type { AnySheetDefinition } from './workbook'
import {
  buildDeliverableRows,
  buildExceptionRows,
  buildFamilyHeadRows,
  buildGuestMasterRows,
  buildRoomAllocationRows,
  type DeliverableRowExport,
  type ExceptionRow,
  type ExportData,
  type FamilyHeadRow,
  type GuestMasterRow,
  type RoomAllocationRow,
} from './sheets'

export type ExportSheetDefinition = AnySheetDefinition

/**
 * Build the sheet definitions for the full export workbook.
 *
 * The Guest Master headers MUST match the import parser's known layout
 * (src/lib/import/layout.ts) exactly — that is what makes a re-import
 * round-trip safely. The `_id` column carries the group UUID for the
 * round-trip test's "updated, not inserted" assertion.
 */
export function buildSheetDefinitions(data: ExportData): ExportSheetDefinition[] {
  const guestMasterRows = buildGuestMasterRows(data)
  const familyHeadRows = buildFamilyHeadRows(data)
  const roomRows = buildRoomAllocationRows(data)
  const deliverableRows = buildDeliverableRows(data)
  const exceptionRows = buildExceptionRows(data)

  return [
    guestMasterSheet(guestMasterRows),
    familyHeadsSheet(familyHeadRows),
    roomAllocationSheet(roomRows),
    deliverablesSheet(deliverableRows),
    exceptionsSheet(exceptionRows),
  ]
}

// ---------------------------------------------------------------------------
// Sheet 1 — Guest Master. Headers EXACTLY match the import layout.
// ---------------------------------------------------------------------------

function guestMasterSheet(rows: GuestMasterRow[]): AnySheetDefinition {
  return {
    name: 'Guest Master',
    rows,
    columns: [
      { key: '_id', header: '_id', type: 'string', width: 36 },
      { key: 'u', header: 'U', type: 'string', width: 6 },
      { key: 'srNo', header: 'SR.NO', type: 'string', width: 8 },
      { key: 'name', header: '', type: 'string', width: 28 },
      { key: 'place', header: 'PLACE', type: 'string', width: 18 },
      { key: 'contact', header: 'CONTACT', type: 'string', width: 16 },
      { key: 'pax', header: 'Pax', type: 'number', width: 8 },
      { key: 'arrivalDate', header: 'Arrival Date', type: 'string', width: 14 },
      { key: 'arrivalTime', header: 'Time', type: 'time', width: 8 },
      { key: 'arrivalMode', header: 'Mode', type: 'string', width: 12 },
      { key: 'arrivalDetails', header: 'Details', type: 'text', width: 22 },
      { key: 'pickUp', header: 'Pick up', type: 'text', width: 16 },
      { key: 'remark', header: 'Remark', type: 'text', width: 26 },
      { key: 'departureDate', header: 'Departure Date', type: 'string', width: 14 },
      { key: 'departureTime', header: 'Time', type: 'time', width: 8 },
      { key: 'departureMode', header: 'Mode', type: 'string', width: 12 },
      { key: 'departureDetails', header: 'Details', type: 'text', width: 22 },
      { key: 'drop', header: 'Drop', type: 'text', width: 16 },
    ],
  }
}

// ---------------------------------------------------------------------------
// Sheet 2 — Family Heads (one row per group)
// ---------------------------------------------------------------------------

function familyHeadsSheet(rows: FamilyHeadRow[]): AnySheetDefinition {
  return {
    name: 'Family Heads',
    rows,
    columns: [
      { key: '_id', header: '_id', type: 'string', width: 36 },
      { key: 'headName', header: 'Family head', type: 'string', width: 28 },
      { key: 'groupType', header: 'Type', type: 'string', width: 10 },
      { key: 'side', header: 'Side', type: 'string', width: 10 },
      { key: 'city', header: 'City', type: 'string', width: 14 },
      { key: 'phone', header: 'Phone', type: 'string', width: 16 },
      { key: 'adults', header: 'Adults', type: 'number', width: 8 },
      { key: 'children', header: 'Children', type: 'number', width: 8 },
      { key: 'expectedPax', header: 'Expected pax', type: 'number', width: 10 },
      { key: 'rsvpStatus', header: 'RSVP', type: 'string', width: 14 },
      { key: 'priority', header: 'Priority', type: 'number', width: 8 },
      { key: 'room', header: 'Room', type: 'string', width: 20 },
      { key: 'arrival', header: 'Arrival', type: 'text', width: 28 },
      { key: 'departure', header: 'Departure', type: 'text', width: 28 },
    ],
  }
}

// ---------------------------------------------------------------------------
// Sheet 3 — Room Allocation
// ---------------------------------------------------------------------------

function roomAllocationSheet(rows: RoomAllocationRow[]): AnySheetDefinition {
  return {
    name: 'Room Allocation',
    rows,
    columns: [
      { key: 'hotel', header: 'Hotel', type: 'string', width: 24 },
      { key: 'roomNumber', header: 'Room', type: 'string', width: 10 },
      { key: 'roomType', header: 'Type', type: 'string', width: 12 },
      { key: 'headName', header: 'Family head', type: 'string', width: 28 },
      { key: 'checkInDate', header: 'Check-in', type: 'date', width: 14 },
      { key: 'checkInTime', header: 'Time', type: 'time', width: 8 },
      { key: 'checkOutDate', header: 'Check-out', type: 'date', width: 14 },
      { key: 'checkOutTime', header: 'Time', type: 'time', width: 8 },
      { key: 'released', header: 'Status', type: 'string', width: 10 },
    ],
  }
}

// ---------------------------------------------------------------------------
// Sheet 4 — Deliverables
// ---------------------------------------------------------------------------

function deliverablesSheet(rows: DeliverableRowExport[]): AnySheetDefinition {
  return {
    name: 'Deliverables',
    rows,
    columns: [
      { key: 'headName', header: 'Family head', type: 'string', width: 28 },
      { key: 'kind', header: 'Kind', type: 'string', width: 12 },
      { key: 'itemName', header: 'Item', type: 'text', width: 24 },
      { key: 'quantity', header: 'Qty', type: 'number', width: 8 },
      { key: 'status', header: 'Status', type: 'string', width: 14 },
      { key: 'deliveredAt', header: 'Delivered at', type: 'string', width: 18 },
      { key: 'deliveredBy', header: 'Delivered by', type: 'string', width: 18 },
    ],
  }
}

// ---------------------------------------------------------------------------
// Sheet 5 — Exceptions (the chase list). Amber rows.
// ---------------------------------------------------------------------------

function exceptionsSheet(rows: ExceptionRow[]): AnySheetDefinition {
  return {
    name: 'Exceptions',
    rows,
    columns: [
      { key: 'headName', header: 'Family head', type: 'string', width: 28 },
      { key: 'phone', header: 'Phone', type: 'string', width: 16 },
      { key: 'issue', header: 'Issue', type: 'text', width: 40 },
      { key: 'detail', header: 'Detail', type: 'text', width: 30 },
    ],
    // Every row in this sheet is an exception — amber all of them.
    isException: () => true,
  }
}
