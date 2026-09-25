/**
 * The rooming-list sheet — the one artifact a hotel is actually handed.
 *
 * WHY IT IS NOT A SHEET IN `definitions.ts`. That workbook is the whole-event
 * export: nine sheets, round-trip-safe, driven by `readExportData` which pulls
 * every table on the event. This one is a single sheet built from the rows
 * ALREADY ON THE SCREEN, so what a person exports is exactly what they are
 * looking at, including the filter and the sort they chose. Wiring it through
 * `readExportData` would re-read the event and quietly hand over a different
 * list from the one on the phone.
 *
 * It reuses `buildWorkbook` and its `SheetColumn` contract, so every format trap
 * that file documents (dates as real date cells, nulls as empty cells, frozen
 * header, autofilter) is handled in one place rather than twice.
 */

import {
  checkInLabel,
  familyLabel,
  guestNamesLabel,
  hamperLabel,
  type RoomingListRow,
} from '@/lib/rooms/rooming-list'
import { type AnySheetDefinition, type SheetColumn } from './workbook'

export const ROOMING_LIST_SHEET_NAME = 'Rooming list'

/**
 * The columns, in the order the ticket asks for, plus Floor.
 *
 * FLOOR IS AN ADDITION AND IT IS DELIBERATE. `rooms.floor` is free text as the
 * hotel writes it ("G", "Mezzanine", "2nd"), it is already on every row, and a
 * printed rooming list without it makes a housekeeping supervisor look up every
 * room number one at a time. It sits beside the room number rather than at the
 * end so the three place columns read together.
 *
 * Every column is `type: 'string'` or `'text'`. NOT an oversight: a room number
 * like "0214" is a string that Excel would coerce to the number 214 and strip
 * the leading zero from (the same trap `workbook.ts` documents for phone
 * numbers), and Pax is the one genuine number here.
 */
export const roomingListColumns: SheetColumn<RoomingListRow>[] = [
  { key: 'hotelName', header: 'Hotel', type: 'string', width: 24 },
  { key: 'roomNumber', header: 'Room no.', type: 'string', width: 12 },
  { key: 'floor', header: 'Floor', type: 'string', width: 10 },
  { key: 'roomType', header: 'Type', type: 'string', width: 18 },
  { key: 'headName', header: 'Family head', type: 'string', width: 26, value: familyLabel },
  { key: 'pax', header: 'Pax', type: 'number', width: 7 },
  { key: 'guestNames', header: 'Guest names', type: 'text', width: 44, value: guestNamesLabel },
  { key: 'checkIn', header: 'Check-in', type: 'string', width: 14, value: checkInLabel },
  { key: 'hamper', header: 'Hamper', type: 'string', width: 14, value: hamperLabel },
]

/**
 * The sheet, from the rows on screen in the order they are on screen.
 *
 * NOT re-sorted here. The screen's sort is a decision the person made — most
 * often "show me everyone still to arrive" — and re-sorting on the way out
 * would hand them a sheet that disagrees with the one they were reading.
 *
 * AMBER = ACTION, the rule from `workbook.ts`. An exception row here is a room
 * that is out of service, or a family that has not arrived, or a hamper still
 * owed: the three things somebody has to do something about. A delivered hamper
 * in a checked-in room is not coloured, because there is nothing to do.
 */
export function roomingListSheet(rows: readonly RoomingListRow[]): AnySheetDefinition {
  return {
    name: ROOMING_LIST_SHEET_NAME,
    columns: roomingListColumns,
    rows: [...rows],
    // Annotated `unknown` and narrowed, which is how `definitions.ts` passes
    // `isException` (see `exceptionsSheet`): `buildWorkbook` takes the widened
    // `AnySheetDefinition`, whose predicate is `(row: unknown) => boolean`, and
    // a `(row: RoomingListRow) => boolean` is not assignable to it under
    // `strictFunctionTypes` — the parameter would have to accept anything.
    isException: (row: unknown) => {
      const r = row as RoomingListRow
      return r.isBlocked || r.checkIn === 'not_yet' || r.hamper === 'pending'
    },
    headerNote: 'Amber = needs action',
  }
}

/** `Nuvent_Rooming_List_Sharma_Wedding_2026-08-16_1430.xlsx` */
export function roomingListFileName(eventName: string, at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
    `_${pad(at.getHours())}${pad(at.getMinutes())}`
  // The same sanitising as the guest export: word characters, spaces and
  // hyphens only, then spaces to underscores. An event named "Sharma / Patel"
  // would otherwise produce a path segment in the filename.
  const part = (eventName || 'Event').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')
  return `EventFlow_Rooming_List_${part || 'Event'}_${stamp}.xlsx`
}
