import type {
  AssignmentRow,
  ClientRecord,
  DeliverableRow,
  DriverRow,
  EventState,
  GroupRow,
  GuestRow,
  HotelRow,
  LegRow,
  OdometerRow,
  ProofRow,
  RecordKey,
  RoomRow,
  RowKey,
  SnapshotData,
  StaffRow,
  StoreOp,
  TripPassengerRow,
  TripRow,
  VehicleAssignmentRow,
  VehicleRow,
  VehicleTypeRow,
} from './types'

/**
 * The three pure state transitions: ops applied, ops inverted, a delta merged.
 *
 * WHY THEY ARE PURE AND SEPARATE FROM THE ENGINE. Everything that can put a
 * wrong number in front of a runner lives here — a merge that keeps a released
 * assignment, an optimistic patch that survives a server refusal, an inversion
 * that undoes somebody else's write. Keeping it out of React and out of Dexie
 * means each of those is a two-line test with a literal state, which is what
 * `tests/store-reducer.test.ts` is. The engine then only has to be right about
 * *when* to call these, not about what they do.
 */

/** Which record map an op touches. Used to copy lazily and to invert. */
export function opKey(op: StoreOp): RecordKey {
  switch (op.t) {
    case 'group.patch':
      return 'groups'
    case 'leg.patch':
      return 'legs'
    case 'assignment.patch':
      return 'assignments'
    case 'deliverable.patch':
      return 'deliverables'
    case 'vehicle.patch':
      return 'vehicles'
    case 'trip.patch':
      return 'trips'
    case 'staff.patch':
      return 'staff'
    case 'row.set':
    case 'row.remove':
      return op.key
    case 'callStat.set':
    case 'callStat.bump':
      return 'callStats'
  }
}

/**
 * A shallow copy of the state in which only the touched record maps are new.
 *
 * The laziness is not micro-optimisation, it is what makes the selector cache
 * work: `selectors.ts` memoises a whole screen's derived rows against the
 * identity of the maps it reads, so copying all eighteen maps on every write
 * would rebuild every derived list on the screen after every tap.
 */
function withFreshMaps(state: EventState, keys: ReadonlySet<RecordKey>): EventState {
  const fresh = (key: RecordKey): boolean => keys.has(key)
  return {
    ...state,
    groups: fresh('groups') ? { ...state.groups } : state.groups,
    guests: fresh('guests') ? { ...state.guests } : state.guests,
    legs: fresh('legs') ? { ...state.legs } : state.legs,
    callStats: fresh('callStats') ? { ...state.callStats } : state.callStats,
    hotels: fresh('hotels') ? { ...state.hotels } : state.hotels,
    rooms: fresh('rooms') ? { ...state.rooms } : state.rooms,
    assignments: fresh('assignments') ? { ...state.assignments } : state.assignments,
    deliverables: fresh('deliverables') ? { ...state.deliverables } : state.deliverables,
    proofs: fresh('proofs') ? { ...state.proofs } : state.proofs,
    vehicles: fresh('vehicles') ? { ...state.vehicles } : state.vehicles,
    vehicleTypes: fresh('vehicleTypes') ? { ...state.vehicleTypes } : state.vehicleTypes,
    trips: fresh('trips') ? { ...state.trips } : state.trips,
    tripPassengers: fresh('tripPassengers') ? { ...state.tripPassengers } : state.tripPassengers,
    drivers: fresh('drivers') ? { ...state.drivers } : state.drivers,
    vehicleAssignments: fresh('vehicleAssignments')
      ? { ...state.vehicleAssignments }
      : state.vehicleAssignments,
    odometer: fresh('odometer') ? { ...state.odometer } : state.odometer,
    staff: fresh('staff') ? { ...state.staff } : state.staff,
    client: fresh('client') ? { ...state.client } : state.client,
  }
}

/**
 * Write one whole row into the map its key names.
 *
 * The `as` casts are downcasts to the concrete row type, which is what makes
 * the union small enough to invert exhaustively. A mismatched key/row pair is
 * a programming error the tests catch; the type system cannot express "the row
 * type for this key" without a mapped-type dance that would make every call
 * site harder to read than the three lines it saves here.
 */
function setRow(state: EventState, key: RowKey, row: { id: string }): void {
  switch (key) {
    case 'groups':
      state.groups[row.id] = row as GroupRow
      break
    case 'guests':
      state.guests[row.id] = row as GuestRow
      break
    case 'legs':
      state.legs[row.id] = row as LegRow
      break
    case 'hotels':
      state.hotels[row.id] = row as HotelRow
      break
    case 'rooms':
      state.rooms[row.id] = row as RoomRow
      break
    case 'assignments':
      // Only an ACTIVE assignment belongs in this map: every screen reads it
      // as "who is in a room right now" (see the migration's `released_at is
      // null` filter). A row with a release stamp is a contradiction here, so
      // it is removed instead of stored.
      if ((row as AssignmentRow).released_at === null) {
        state.assignments[row.id] = row as AssignmentRow
      } else {
        delete state.assignments[row.id]
      }
      break
    case 'deliverables':
      state.deliverables[row.id] = row as DeliverableRow
      break
    case 'proofs':
      state.proofs[row.id] = row as ProofRow
      break
    case 'vehicles':
      state.vehicles[row.id] = row as VehicleRow
      break
    case 'vehicleTypes':
      state.vehicleTypes[row.id] = row as VehicleTypeRow
      break
    case 'trips':
      state.trips[row.id] = row as TripRow
      break
    case 'tripPassengers':
      state.tripPassengers[row.id] = row as TripPassengerRow
      break
    case 'drivers':
      state.drivers[row.id] = row as DriverRow
      break
    case 'vehicleAssignments':
      state.vehicleAssignments[row.id] = row as VehicleAssignmentRow
      break
    case 'odometer':
      state.odometer[row.id] = row as OdometerRow
      break
    case 'staff':
      state.staff[row.id] = row as StaffRow
      break
    case 'client':
      state.client[row.id] = row as ClientRecord
      break
  }
}

/** Remove one row by its map key. */
export function removeRow(state: EventState, key: RowKey, id: string): void {
  delete state[key][id]
}

/** The row a key/id addresses, or null. Used to invert adds and removes. */
function getRow(state: EventState, key: RowKey, id: string): { id: string } | null {
  return state[key][id] ?? null
}

/** A patch to a row that may not be in the store yet. */
function patchInto<T extends object>(
  map: Record<string, T>,
  id: string,
  patch: Partial<T>,
): void {
  const existing = map[id]
  // A patch for a row we do not hold is a no-op, deliberately. Inventing the
  // row from a partial patch would put a half-populated family on a screen and
  // every selector would then read `undefined` fields as real blanks. The next
  // catch-up brings the whole row.
  if (!existing) return
  map[id] = { ...existing, ...patch }
}

/** Apply a list of optimistic ops. Pure; returns a new state (or the same one). */
export function applyOps(state: EventState, ops: readonly StoreOp[]): EventState {
  if (ops.length === 0) return state

  const keys = new Set<RecordKey>()
  for (const op of ops) keys.add(opKey(op))
  const next = withFreshMaps(state, keys)

  for (const op of ops) {
    switch (op.t) {
      case 'group.patch':
        patchInto(next.groups, op.id, op.patch)
        break
      case 'leg.patch':
        patchInto(next.legs, op.id, op.patch)
        break
      case 'assignment.patch':
        patchInto(next.assignments, op.id, op.patch)
        break
      case 'deliverable.patch':
        patchInto(next.deliverables, op.id, op.patch)
        break
      case 'vehicle.patch':
        patchInto(next.vehicles, op.id, op.patch)
        break
      case 'trip.patch':
        patchInto(next.trips, op.id, op.patch)
        break
      case 'staff.patch':
        patchInto(next.staff, op.id, op.patch)
        break
      case 'row.set':
        setRow(next, op.key, op.row)
        break
      case 'row.remove':
        removeRow(next, op.key, op.id)
        break
      case 'callStat.set':
        if (op.stat === null) delete next.callStats[op.groupId]
        else next.callStats[op.groupId] = op.stat
        break
      case 'callStat.bump': {
        const previous = next.callStats[op.groupId]
        next.callStats[op.groupId] = {
          groupId: op.groupId,
          n: (previous?.n ?? 0) + 1,
          lastAt: op.at,
          // An OPEN dial (no outcome yet) makes the newest outcome null:
          // `(array_agg(outcome order by started_at desc))[1]` over an attempt
          // that has not closed is null. Matching that here is what keeps the
          // optimistic queue row identical to the one the server sends next.
          lastOutcome: op.open ? null : op.outcome,
          nextCallbackAt:
            op.open || op.nextCallbackAt === null
              ? (previous?.nextCallbackAt ?? null)
              : op.nextCallbackAt,
        }
        break
      }
    }
  }

  return next
}

/** The old values of the listed keys, or nothing when the row is absent. */
function oldValues<T extends object>(
  map: Record<string, T>,
  id: string,
  keys: readonly string[],
): Partial<T> | null {
  const row = map[id]
  if (!row) return null
  const patch: Record<string, unknown> = {}
  for (const key of keys) patch[key] = (row as Record<string, unknown>)[key]
  return patch as Partial<T>
}

/**
 * The ops that undo `ops`, computed against the state they are about to be
 * applied to.
 *
 * WHY NOT RESTORE A SNAPSHOT. `stageOptimisticWrite` reverts by writing the
 * previous cache value back, which also throws away any OTHER optimistic patch
 * made in between — its own header admits this. On the rooms board that is a
 * real sequence: place a family, then move a guest, then the first write is
 * refused, and the move silently disappears. Inverting op by op touches only
 * the rows this write touched.
 *
 * An op with nothing to invert (a patch for a row the store never held)
 * contributes nothing, which is correct: the forward op was a no-op too.
 */
export function invertOps(before: EventState, ops: readonly StoreOp[]): StoreOp[] {
  const out: StoreOp[] = []

  for (const op of ops) {
    switch (op.t) {
      case 'group.patch': {
        const patch = oldValues(before.groups, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'group.patch', id: op.id, patch })
        break
      }
      case 'leg.patch': {
        const patch = oldValues(before.legs, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'leg.patch', id: op.id, patch })
        break
      }
      case 'assignment.patch': {
        const patch = oldValues(before.assignments, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'assignment.patch', id: op.id, patch })
        break
      }
      case 'deliverable.patch': {
        const patch = oldValues(before.deliverables, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'deliverable.patch', id: op.id, patch })
        break
      }
      case 'vehicle.patch': {
        const patch = oldValues(before.vehicles, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'vehicle.patch', id: op.id, patch })
        break
      }
      case 'trip.patch': {
        const patch = oldValues(before.trips, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'trip.patch', id: op.id, patch })
        break
      }
      case 'staff.patch': {
        const patch = oldValues(before.staff, op.id, Object.keys(op.patch))
        if (patch) out.push({ t: 'staff.patch', id: op.id, patch })
        break
      }
      case 'row.set': {
        const existing = getRow(before, op.key, op.row.id)
        out.push(
          existing
            ? { t: 'row.set', key: op.key, row: existing }
            : { t: 'row.remove', key: op.key, id: op.row.id },
        )
        break
      }
      case 'row.remove': {
        const existing = getRow(before, op.key, op.id)
        // A release is the only removal a screen performs optimistically, and
        // putting the exact row back is what restores the room's occupancy.
        if (existing) out.push({ t: 'row.set', key: op.key, row: existing })
        break
      }
      case 'callStat.set': {
        const existing = before.callStats[op.groupId]
        out.push({ t: 'callStat.set', groupId: op.groupId, stat: existing ?? null })
        break
      }
      case 'callStat.bump': {
        const existing = before.callStats[op.groupId]
        out.push({ t: 'callStat.set', groupId: op.groupId, stat: existing ?? null })
        break
      }
    }
  }

  return out
}

/**
 * Merge a `event_changes_since` delta into the state.
 *
 * REPLACE BY ID, PER TABLE, NEVER CLEAR. That asymmetry with the full snapshot
 * is the whole point: a delta says "these rows changed", not "this is the
 * table". Clearing would wipe a whole screen on every catch-up that happened
 * to carry one row.
 *
 * ASSIGNMENTS ARE THE ONE ROW THE STORE CAN DROP. A soft release is an UPDATE,
 * so a delta carries the row with `released_at` set, and `setRow` removes it
 * from the active map. That is also the only "delete" the delta needs to
 * express: nothing on the tap path is hard-deleted, and a hard delete
 * elsewhere is invisible to a delta by design (see the migration header) —
 * which is why the engine still takes a full snapshot on resume.
 */
export function mergeChanges(state: EventState, delta: SnapshotData, dropped = 0): EventState {
  const ops: StoreOp[] = []

  for (const row of delta.groups) ops.push({ t: 'row.set', key: 'groups', row })
  for (const row of delta.guests) ops.push({ t: 'row.set', key: 'guests', row })
  for (const row of delta.legs) ops.push({ t: 'row.set', key: 'legs', row })
  for (const stat of delta.callStats) {
    ops.push({ t: 'callStat.set', groupId: stat.groupId, stat })
  }
  for (const row of delta.hotels) ops.push({ t: 'row.set', key: 'hotels', row })
  for (const row of delta.rooms) ops.push({ t: 'row.set', key: 'rooms', row })
  for (const row of delta.assignments) ops.push({ t: 'row.set', key: 'assignments', row })
  for (const row of delta.deliverables) ops.push({ t: 'row.set', key: 'deliverables', row })
  for (const row of delta.proofs) ops.push({ t: 'row.set', key: 'proofs', row })
  for (const row of delta.vehicles) ops.push({ t: 'row.set', key: 'vehicles', row })
  for (const row of delta.vehicleTypes) ops.push({ t: 'row.set', key: 'vehicleTypes', row })
  for (const row of delta.trips) ops.push({ t: 'row.set', key: 'trips', row })
  for (const row of delta.tripPassengers) {
    ops.push({ t: 'row.set', key: 'tripPassengers', row })
  }
  for (const row of delta.drivers) ops.push({ t: 'row.set', key: 'drivers', row })
  for (const row of delta.vehicleAssignments) {
    ops.push({ t: 'row.set', key: 'vehicleAssignments', row })
  }
  for (const row of delta.odometer) ops.push({ t: 'row.set', key: 'odometer', row })
  for (const row of delta.staff) ops.push({ t: 'row.set', key: 'staff', row })
  // The client array is only ever sent whole (the view has no updated_at), so
  // it is a replace, not a merge. Anything the phone held and the server did
  // not send is genuinely gone from the view.
  if (delta.role === 'client') {
    for (const id of Object.keys(state.client)) {
      ops.push({ t: 'row.remove', key: 'client', id })
    }
  }
  for (const row of delta.client) {
    if (row.guest_id) {
      ops.push({ t: 'row.set', key: 'client', row: { ...row, id: row.guest_id } })
    }
  }

  const next = applyOps(state, ops)

  // ISO-8601 timestamps compare lexicographically, so a delta that arrived out
  // of order (two catch-ups racing on reconnect) must not move the watermark
  // backwards — that would re-deliver rows the phone has already applied, and
  // worse, would make the NEXT delta re-deliver them a third time.
  const watermark =
    delta.watermark && (!state.watermark || delta.watermark >= state.watermark)
      ? delta.watermark
      : state.watermark

  return {
    ...next,
    watermark,
    at: delta.at ?? next.at,
    dropped: next.dropped + dropped,
  }
}
