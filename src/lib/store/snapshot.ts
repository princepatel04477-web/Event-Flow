import type {
  AssignmentRow,
  CallStatRow,
  ClientProfileRow,
  ClientRecord,
  DeliverableRow,
  DriverRow,
  EventHeader,
  EventState,
  GroupRow,
  GuestRow,
  HotelRow,
  LegRow,
  OdometerRow,
  ProofRow,
  RecordKey,
  RoomRow,
  SnapshotData,
  SnapshotRole,
  StaffRow,
  TripPassengerRow,
  TripRow,
  VehicleAssignmentRow,
  VehicleRow,
  VehicleTypeRow,
} from './types'

/**
 * Turning whatever came over the wire into a typed store.
 *
 * WHY THIS IS DEFENSIVE RATHER THAN A CAST. `RawSnapshot` is `unknown`-ish on
 * every array because a PostgREST `jsonb` return is not trusted by the
 * compiler and, more importantly, is not trusted by us: the migration and the
 * deployed app ship separately, so an older phone can meet a newer function.
 * A blind cast would put a string where the UI expects a number and the
 * failure would appear as "NaN guests" three screens away. So the envelope is
 * validated strictly, every array is checked to BE an array, and every row is
 * checked to be an object with a usable id. Anything else is dropped and
 * COUNTED (`state.dropped`), because a shape change that silently empties a
 * screen is the one failure this whole layer exists to make visible.
 *
 * WHAT IS *NOT* VALIDATED, and why that is a deliberate stopping point: the
 * individual fields of a row. There are twelve tables and ~150 columns; a
 * hand-written validator per column would be a second schema to keep in sync,
 * it would drift the first time a migration added a column, and the type error
 * it would have caught is already caught by `Omit<Row, 'event_id'>` in
 * `types.ts` at compile time. The row's `id` is the only field the store
 * itself dereferences, so it is the only one checked here.
 *
 * See `supabase/migrations/20260922120000_event_snapshot.sql` for the shapes.
 */

/** The payload version this client understands. A newer one is refused. */
export const SNAPSHOT_VERSION = 1

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Rows that carry a usable id, and a count of those that do not.
 *
 * The id is the store's only hard requirement — it is the record map's key,
 * and every selector, merge and rollback addresses rows by it.
 */
function rowsWithId<T>(value: unknown): { rows: T[]; dropped: number } {
  if (!Array.isArray(value)) return { rows: [], dropped: 0 }
  const rows: T[] = []
  let dropped = 0
  for (const entry of value) {
    if (!isRecord(entry) || asString(entry.id) === null) {
      dropped += 1
      continue
    }
    rows.push(entry as unknown as T)
  }
  return { rows, dropped }
}

/**
 * `client_guest_profiles` is keyed by `guest_id`, which the generated view
 * type admits as nullable. A row without one cannot be shown or addressed.
 */
function clientRows(value: unknown): { rows: ClientProfileRow[]; dropped: number } {
  if (!Array.isArray(value)) return { rows: [], dropped: 0 }
  const rows: ClientProfileRow[] = []
  let dropped = 0
  for (const entry of value) {
    if (!isRecord(entry) || asString(entry.guest_id) === null) {
      dropped += 1
      continue
    }
    rows.push(entry as unknown as ClientProfileRow)
  }
  return { rows, dropped }
}

/** `callStats` is keyed by `groupId`, not `id`. */
function callStats(value: unknown): { rows: CallStatRow[]; dropped: number } {
  if (!Array.isArray(value)) return { rows: [], dropped: 0 }
  const rows: CallStatRow[] = []
  let dropped = 0
  for (const entry of value) {
    if (!isRecord(entry) || asString(entry.groupId) === null) {
      dropped += 1
      continue
    }
    rows.push(entry as unknown as CallStatRow)
  }
  return { rows, dropped }
}

function asRole(value: unknown): SnapshotRole {
  if (value === 'client') return 'client'
  if (value === 'admin') return 'admin'
  return 'team'
}

function asEventHeader(value: unknown): EventHeader | null {
  if (!isRecord(value)) return null
  const id = asString(value.id)
  if (!id) return null
  return {
    id,
    code: asString(value.code) ?? '',
    name: asString(value.name),
    startsOn: asString(value.startsOn),
    endsOn: asString(value.endsOn),
    venueCity: asString(value.venueCity),
    brideName: asString(value.brideName),
    groomName: asString(value.groomName),
    archivedAt: asString(value.archivedAt),
  }
}

/** Record maps, built once here so no selector has to scan an array. */
function indexById<T extends { id: string }>(rows: readonly T[]): Record<string, T> {
  const out: Record<string, T> = {}
  for (const row of rows) out[row.id] = row
  return out
}

function indexCallStats(rows: readonly CallStatRow[]): Record<string, CallStatRow> {
  const out: Record<string, CallStatRow> = {}
  for (const row of rows) out[row.groupId] = row
  return out
}

function indexClient(rows: readonly ClientProfileRow[]): Record<string, ClientRecord> {
  const out: Record<string, ClientRecord> = {}
  for (const row of rows) {
    if (row.guest_id) out[row.guest_id] = { ...row, id: row.guest_id }
  }
  return out
}

/**
 * Validate and normalise a raw payload.
 *
 * Returns `null` when the payload is not a snapshot at all — not an object, or
 * a version this client does not understand. A `null` here is what makes the
 * engine fall back to the pre-store reads rather than paint nonsense, so it is
 * deliberately a "refuse", not a "best effort".
 *
 * A CLIENT payload legitimately has no staff arrays; they normalise to empty
 * because `Promise`-less code reading `state.groups` should not have to know
 * which role it is. `state.role` is the single place that distinction lives,
 * and no client-reachable selector reads a staff table — the arrays are empty
 * server-side, by policy (see the migration).
 */
export function parseSnapshot(raw: unknown): { data: SnapshotData; dropped: number } | null {
  if (!isRecord(raw)) return null
  const version = typeof raw.v === 'number' ? raw.v : 0
  if (version !== SNAPSHOT_VERSION) return null

  const event = asEventHeader(raw.event)
  if (!event) return null

  let dropped = 0
  const take = <T,>(value: unknown): T[] => {
    const result = rowsWithId<T>(value)
    dropped += result.dropped
    return result.rows
  }

  const client = clientRows(raw.client)
  dropped += client.dropped
  const stats = callStats(raw.callStats)
  dropped += stats.dropped

  return {
    data: {
      version,
      role: asRole(raw.role),
      at: asString(raw.at),
      watermark: asString(raw.watermark),
      event,
      groups: take<GroupRow>(raw.groups),
      guests: take<GuestRow>(raw.guests),
      legs: take<LegRow>(raw.legs),
      callStats: stats.rows,
      hotels: take<HotelRow>(raw.hotels),
      rooms: take<RoomRow>(raw.rooms),
      assignments: take<AssignmentRow>(raw.assignments),
      deliverables: take<DeliverableRow>(raw.deliverables),
      proofs: take<ProofRow>(raw.proofs),
      vehicles: take<VehicleRow>(raw.vehicles),
      vehicleTypes: take<VehicleTypeRow>(raw.vehicleTypes),
      trips: take<TripRow>(raw.trips),
      tripPassengers: take<TripPassengerRow>(raw.tripPassengers),
      drivers: take<DriverRow>(raw.drivers),
      vehicleAssignments: take<VehicleAssignmentRow>(raw.vehicleAssignments),
      odometer: take<OdometerRow>(raw.odometer),
      staff: take<StaffRow>(raw.staff),
      client: client.rows,
    },
    dropped,
  }
}

/** An empty, legal state. The server-render snapshot, and the unit-test default. */
export function emptyState(eventId: string): EventState {
  return {
    eventId,
    mode: 'loading',
    role: 'team',
    status: 'empty',
    watermark: null,
    at: null,
    error: null,
    syncing: false,
    staleForMs: null,
    event: null,
    groups: {},
    guests: {},
    legs: {},
    callStats: {},
    hotels: {},
    rooms: {},
    assignments: {},
    deliverables: {},
    proofs: {},
    vehicles: {},
    vehicleTypes: {},
    trips: {},
    tripPassengers: {},
    drivers: {},
    vehicleAssignments: {},
    odometer: {},
    staff: {},
    client: {},
    dropped: 0,
  }
}

/**
 * A parsed snapshot becomes a readable state.
 *
 * A FULL SNAPSHOT REPLACES EVERY TABLE. It is not a merge: the whole point of
 * the full snapshot is that it is the truth including the rows the phone
 * cannot see disappear (see `mergeChanges` for the other direction). Merging
 * here would leave a deleted room on the board for the rest of the shift.
 */
export function stateFromSnapshot(
  eventId: string,
  data: SnapshotData,
  dropped = 0,
): EventState {
  return {
    ...emptyState(eventId),
    mode: 'store',
    role: data.role,
    status: 'ready',
    watermark: data.watermark,
    at: data.at,
    event: data.event,
    groups: indexById(data.groups),
    guests: indexById(data.guests),
    legs: indexById(data.legs),
    callStats: indexCallStats(data.callStats),
    hotels: indexById(data.hotels),
    rooms: indexById(data.rooms),
    assignments: indexById(data.assignments),
    deliverables: indexById(data.deliverables),
    proofs: indexById(data.proofs),
    vehicles: indexById(data.vehicles),
    vehicleTypes: indexById(data.vehicleTypes),
    trips: indexById(data.trips),
    tripPassengers: indexById(data.tripPassengers),
    drivers: indexById(data.drivers),
    vehicleAssignments: indexById(data.vehicleAssignments),
    odometer: indexById(data.odometer),
    staff: indexById(data.staff),
    client: indexClient(data.client),
    dropped,
  }
}

/** The record keys a delta can carry, in the order the migration emits them. */
export const RECORD_KEYS: readonly RecordKey[] = [
  'groups',
  'guests',
  'legs',
  'callStats',
  'hotels',
  'rooms',
  'assignments',
  'deliverables',
  'proofs',
  'vehicles',
  'vehicleTypes',
  'trips',
  'tripPassengers',
  'drivers',
  'vehicleAssignments',
  'odometer',
  'staff',
  'client',
]
