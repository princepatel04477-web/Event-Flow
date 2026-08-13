/**
 * Recovering room allocations from the original Excel rows.
 *
 * The import stored every sheet row in `import_rows.raw`, keyed by the
 * sheet's own header text. Two of those columns — `Romm` (the real spelling
 * in the file) and `bed` — were parsed but never used. This module reads them
 * back out, so no re-upload is needed.
 *
 * Pure and dependency-free: the preview the user checks is computed by
 * exactly this code, so what they approve is what gets written.
 *
 * Two rules run through the whole file:
 *
 *  1. Anything ambiguous is REPORTED, never guessed. A wrong room number
 *     sends a family to someone else's door.
 *  2. `bed` is a HINT, not capacity. In the source sheet it reads as a bed
 *     count per family, which may or may not be the room's real capacity.
 *     It is surfaced as a suggestion for the user to confirm.
 */

import { isUsableRoomNumber, normalizeRoomNumber, splitRoomCell } from './parse'

// ---------------------------------------------------------------------
// Finding the columns
// ---------------------------------------------------------------------

/**
 * Header spellings that mean "room number". `Romm` is the actual spelling in
 * CALLING_MASTER_LIST; the rest are what a corrected sheet might use.
 */
const ROOM_HEADERS = ['romm', 'room', 'romm no', 'room no', 'romm no.', 'room no.', 'room number']
const BED_HEADERS = ['bed', 'beds', 'bed no', 'bed no.', 'beds no']

function findKey(raw: Record<string, unknown>, candidates: string[]): string | null {
  for (const key of Object.keys(raw)) {
    const normalized = key.trim().toLowerCase().replace(/\s+/g, ' ')
    if (candidates.includes(normalized)) return key
  }
  return null
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') {
    // Excel hands back room numbers as floats often enough to matter.
    return Number.isInteger(value) ? String(value) : String(value)
  }
  return String(value).trim()
}

/** Whether these rows carry a room column at all — drives the empty state. */
export function hasRoomColumn(rows: readonly BackfillSourceRow[]): boolean {
  return rows.some((r) => findKey(r.raw, ROOM_HEADERS) !== null)
}

// ---------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------

export interface BackfillSourceRow {
  rowNumber: number
  groupId: string | null
  raw: Record<string, unknown>
}

export interface BackfillGuest {
  id: string
  fullName: string
  isHead: boolean
}

export interface ExistingRoom {
  id: string
  capacity: number
}

export interface BackfillContext {
  /** group_id -> its guests, head first. */
  guestsByGroup: Map<string, BackfillGuest[]>
  /** group_id -> head name, for display. */
  groupNames: Map<string, string>
  /** normalized room_number -> room, for the chosen hotel only. */
  existingRooms: Map<string, ExistingRoom>
  /** guest_id -> normalized room_number they already actively occupy. */
  activeRoomByGuest: Map<string, string>
  /** Capacity to use for a created room when `bed` is blank. */
  defaultCapacity: number
}

// ---------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------

export type ProblemKind =
  | 'no_room_column'
  | 'blank_room'
  | 'unreadable_room'
  | 'unresolved_group'
  | 'no_guests'
  | 'capacity_short'
  | 'already_elsewhere'

export const PROBLEM_LABELS: Record<ProblemKind, string> = {
  no_room_column: 'Sheet row has no room column',
  blank_room: 'Room number blank in the sheet',
  unreadable_room: 'Room number could not be read',
  unresolved_group: 'Row never became a family',
  no_guests: 'Family has no guest records',
  capacity_short: 'More people than beds',
  already_elsewhere: 'Already allocated to a different room',
}

export interface BackfillProblem {
  rowNumber: number
  kind: ProblemKind
  familyName: string | null
  /** Exactly what the cell said, so the user can fix the sheet. */
  rawValue: string | null
  detail: string
}

export interface PlannedAssignment {
  guestId: string
  guestName: string
  roomNumber: string
}

export interface PlannedFamily {
  rowNumber: number
  groupId: string
  familyName: string
  /** One or more, because "201/202" is one family across two rooms. */
  roomNumbers: string[]
  /** True when the cell held several rooms. */
  fromSplit: boolean
  /** The `bed` cell, verbatim. A hint only. */
  bedHint: number | null
  assignments: PlannedAssignment[]
  /** Guests already in the right room — counted, not re-inserted. */
  alreadyAssigned: number
  /** Other families the sheet also puts in one of these rooms. */
  sharedWith: string[]
}

export interface PlannedRoom {
  roomNumber: string
  /** From `bed` when present, else the user's default. */
  capacity: number
  /** True when capacity came from `bed` and so needs confirming. */
  capacityFromBed: boolean
  /** Families the sheet puts in this room. */
  families: string[]
}

export interface BackfillPlan {
  families: PlannedFamily[]
  /** Families whose guests are already all correctly assigned. */
  unchanged: PlannedFamily[]
  roomsToCreate: PlannedRoom[]
  problems: BackfillProblem[]
  counts: {
    rowsRead: number
    familiesToAssign: number
    guestsToAssign: number
    roomsToCreate: number
    unchanged: number
    problems: number
  }
}

// ---------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------

/**
 * Work out exactly what the backfill would do, without doing any of it.
 *
 * Idempotency lives here rather than in the writer: a guest already actively
 * assigned to the room the sheet names is counted as `alreadyAssigned` and no
 * insert is planned for them. Running the plan twice therefore produces an
 * empty second run.
 */
export function planBackfill(
  rows: readonly BackfillSourceRow[],
  context: BackfillContext,
): BackfillPlan {
  const problems: BackfillProblem[] = []
  const families: PlannedFamily[] = []
  const unchanged: PlannedFamily[] = []

  // Which families the sheet puts in each room — needed both to warn about
  // sharing and to size a room we are about to create.
  const familiesByRoom = new Map<string, string[]>()

  interface Staged {
    row: BackfillSourceRow
    groupId: string
    familyName: string
    rooms: string[]
    fromSplit: boolean
    bedHint: number | null
    guests: BackfillGuest[]
  }
  const staged: Staged[] = []

  for (const row of rows) {
    const roomKey = findKey(row.raw, ROOM_HEADERS)
    const familyName = row.groupId ? (context.groupNames.get(row.groupId) ?? null) : null

    if (roomKey === null) {
      problems.push({
        rowNumber: row.rowNumber,
        kind: 'no_room_column',
        familyName,
        rawValue: null,
        detail: 'This row was imported before the room column existed, or the header was blank.',
      })
      continue
    }

    const rawRoom = cellText(row.raw[roomKey])

    if (rawRoom === '') {
      problems.push({
        rowNumber: row.rowNumber,
        kind: 'blank_room',
        familyName,
        rawValue: null,
        detail: 'No room was written against this family in the sheet.',
      })
      continue
    }

    const tokens = splitRoomCell(rawRoom)
    const usable = tokens.filter((t) => isUsableRoomNumber(t.value))

    if (usable.length === 0) {
      problems.push({
        rowNumber: row.rowNumber,
        kind: 'unreadable_room',
        familyName,
        rawValue: rawRoom,
        detail: 'Nothing in this cell looks like a room number.',
      })
      continue
    }

    if (!row.groupId) {
      problems.push({
        rowNumber: row.rowNumber,
        kind: 'unresolved_group',
        familyName: null,
        rawValue: rawRoom,
        detail: 'The import did not attach this row to a family, so there is nobody to assign.',
      })
      continue
    }

    const guests = context.guestsByGroup.get(row.groupId) ?? []
    if (guests.length === 0) {
      problems.push({
        rowNumber: row.rowNumber,
        kind: 'no_guests',
        familyName,
        rawValue: rawRoom,
        detail: 'This family has no guest rows, so there is nobody to put in the room.',
      })
      continue
    }

    const bedKey = findKey(row.raw, BED_HEADERS)
    const bedText = bedKey ? cellText(row.raw[bedKey]) : ''
    const bedHint = /^\d+$/.test(bedText) && Number(bedText) > 0 ? Number(bedText) : null

    const rooms = usable.map((t) => normalizeRoomNumber(t.value))
    for (const room of rooms) {
      const list = familiesByRoom.get(room) ?? []
      if (familyName && !list.includes(familyName)) list.push(familyName)
      familiesByRoom.set(room, list)
    }

    staged.push({
      row,
      groupId: row.groupId,
      familyName: familyName ?? 'Unknown family',
      rooms,
      fromSplit: usable.some((t) => t.fromSplit),
      bedHint,
      guests,
    })
  }

  // Rooms the sheet names that do not exist yet, sized from `bed` when we
  // have it. Deliberately computed before assignments so capacity checks
  // below can see the size a room is about to be created at.
  const roomsToCreate = new Map<string, PlannedRoom>()
  for (const item of staged) {
    for (const room of item.rooms) {
      if (context.existingRooms.has(room) || roomsToCreate.has(room)) continue
      // A family split across two rooms tells us nothing about either room's
      // size, so `bed` is only trusted as capacity for a single-room family.
      const useBed = item.bedHint !== null && item.rooms.length === 1
      roomsToCreate.set(room, {
        roomNumber: room,
        capacity: useBed ? item.bedHint! : context.defaultCapacity,
        capacityFromBed: useBed,
        families: familiesByRoom.get(room) ?? [],
      })
    }
  }

  const capacityOf = (room: string): number =>
    context.existingRooms.get(room)?.capacity ?? roomsToCreate.get(room)?.capacity ?? 0

  for (const item of staged) {
    const totalBeds = item.rooms.reduce((sum, r) => sum + capacityOf(r), 0)

    // Guests already sitting in one of this family's rooms need no insert —
    // this is what makes a second run a no-op.
    //
    // A guest actively assigned to some OTHER room is a genuine conflict:
    // `room_assignments_one_active_per_guest` would refuse the insert, and
    // silently releasing their current room to honour a spreadsheet would
    // move a real person out of a real bed. Reported, never guessed.
    const needsMove: BackfillGuest[] = []
    const elsewhere: { guest: BackfillGuest; room: string }[] = []
    let alreadyAssigned = 0
    for (const guest of item.guests) {
      const current = context.activeRoomByGuest.get(guest.id)
      if (current && item.rooms.includes(current)) alreadyAssigned++
      else if (current) elsewhere.push({ guest, room: current })
      else needsMove.push(guest)
    }

    if (elsewhere.length > 0) {
      problems.push({
        rowNumber: item.row.rowNumber,
        kind: 'already_elsewhere',
        familyName: item.familyName,
        rawValue: item.rooms.join(' / '),
        detail:
          `${elsewhere.map((e) => `${e.guest.fullName} is in ${e.room}`).join(', ')}, but the ` +
          `sheet says ${item.rooms.join(' / ')}. Release the current allocation first if the ` +
          `sheet is right.`,
      })
      continue
    }

    if (needsMove.length === 0) {
      unchanged.push({
        rowNumber: item.row.rowNumber,
        groupId: item.groupId,
        familyName: item.familyName,
        roomNumbers: item.rooms,
        fromSplit: item.fromSplit,
        bedHint: item.bedHint,
        assignments: [],
        alreadyAssigned,
        sharedWith: sharedOthers(item.rooms, item.familyName, familiesByRoom),
      })
      continue
    }

    if (item.guests.length > totalBeds) {
      problems.push({
        rowNumber: item.row.rowNumber,
        kind: 'capacity_short',
        familyName: item.familyName,
        rawValue: item.rooms.join(' / '),
        detail:
          `${item.guests.length} people but ${totalBeds} bed${totalBeds === 1 ? '' : 's'} across ` +
          `${item.rooms.join(' / ')}. Raise the capacity or split the family before backfilling.`,
      })
      continue
    }

    // Fill rooms in the order the sheet listed them, to capacity. Which
    // individual sleeps where is not knowable from the sheet, and member
    // names are collected later at allocation anyway — so this is a stable
    // order, shown in the preview, not a claim about who is where.
    const assignments: PlannedAssignment[] = []
    let cursor = 0
    let remaining = capacityOf(item.rooms[0]) - countAlreadyIn(item.rooms[0], item.guests, context)
    for (const guest of needsMove) {
      while (cursor < item.rooms.length - 1 && remaining <= 0) {
        cursor++
        remaining = capacityOf(item.rooms[cursor]) - countAlreadyIn(item.rooms[cursor], item.guests, context)
      }
      assignments.push({
        guestId: guest.id,
        guestName: guest.fullName,
        roomNumber: item.rooms[cursor],
      })
      remaining--
    }

    families.push({
      rowNumber: item.row.rowNumber,
      groupId: item.groupId,
      familyName: item.familyName,
      roomNumbers: item.rooms,
      fromSplit: item.fromSplit,
      bedHint: item.bedHint,
      assignments,
      alreadyAssigned,
      sharedWith: sharedOthers(item.rooms, item.familyName, familiesByRoom),
    })
  }

  const roomList = [...roomsToCreate.values()].sort((a, b) =>
    a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }),
  )

  return {
    families,
    unchanged,
    roomsToCreate: roomList,
    problems: problems.sort((a, b) => a.rowNumber - b.rowNumber),
    counts: {
      rowsRead: rows.length,
      familiesToAssign: families.length,
      guestsToAssign: families.reduce((n, f) => n + f.assignments.length, 0),
      roomsToCreate: roomList.length,
      unchanged: unchanged.length,
      problems: problems.length,
    },
  }
}

function countAlreadyIn(
  room: string,
  guests: readonly BackfillGuest[],
  context: BackfillContext,
): number {
  let n = 0
  for (const g of guests) {
    if (context.activeRoomByGuest.get(g.id) === room) n++
  }
  return n
}

function sharedOthers(
  rooms: readonly string[],
  self: string,
  familiesByRoom: Map<string, string[]>,
): string[] {
  const others = new Set<string>()
  for (const room of rooms) {
    for (const name of familiesByRoom.get(room) ?? []) {
      if (name !== self) others.add(name)
    }
  }
  return [...others]
}
