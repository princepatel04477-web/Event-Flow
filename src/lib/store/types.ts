import type { Database } from '@/lib/supabase/database.types'

/**
 * The typed shape of one phone-side event.
 *
 * WHY THIS FILE IS SEPARATE FROM THE HOOKS. Everything below is plain data
 * and plain types, so the reducers, the selectors and the merge logic can be
 * tested with no React, no IndexedDB and no network. That matters more here
 * than anywhere else in the app: if the store is wrong the whole app shows
 * the wrong thing at once, and a bug that only reproduces through a DOM is a
 * bug found on the day.
 *
 * THE ROW TYPES ARE DERIVED FROM THE GENERATED DATABASE TYPES, with
 * `event_id` removed. Not hand-written, deliberately: the migration ships
 * `to_jsonb(row) - 'event_id'`, so the payload's row shape IS the table's
 * shape, and deriving it means a column added by a later migration shows up
 * here as a type error the moment `types:gen` runs rather than as an
 * `undefined` on a phone. `Omit<Row, 'event_id'>` is exact — the migration
 * adds nothing and renames nothing.
 *
 * See `supabase/migrations/20260922120000_event_snapshot.sql` for the
 * server half, including why `groups` also loses `source_row_hash`.
 */

type Tables = Database['public']['Tables']
type Views = Database['public']['Views']
type Enums = Database['app']['Enums']

/** Every row in the payload, minus the event_id that the payload itself carries. */
export type GroupRow = Omit<Tables['guest_groups']['Row'], 'event_id' | 'source_row_hash'>
export type GuestRow = Omit<Tables['guests']['Row'], 'event_id'>
export type LegRow = Omit<Tables['travel_legs']['Row'], 'event_id'>
export type HotelRow = Omit<Tables['hotels']['Row'], 'event_id'>
export type RoomRow = Omit<Tables['rooms']['Row'], 'event_id'>
export type AssignmentRow = Omit<Tables['room_assignments']['Row'], 'event_id'>
export type DeliverableRow = Omit<Tables['deliverables']['Row'], 'event_id'>
export type ProofRow = Omit<Tables['delivery_proofs']['Row'], 'event_id'>
export type VehicleRow = Omit<Tables['vehicles']['Row'], 'event_id'>
export type VehicleTypeRow = Omit<Tables['vehicle_types']['Row'], 'event_id'>
export type TripRow = Omit<Tables['trips']['Row'], 'event_id'>
export type TripPassengerRow = Omit<Tables['trip_passengers']['Row'], 'event_id'>
export type DriverRow = Omit<Tables['drivers']['Row'], 'event_id'>
export type VehicleAssignmentRow = Omit<Tables['vehicle_assignments']['Row'], 'event_id'>
export type OdometerRow = Omit<Tables['odometer_logs']['Row'], 'event_id'>
export type StaffRow = Omit<Tables['staff_members']['Row'], 'event_id'>

/**
 * `client_guest_profiles` keeps its `event_id` — the view's row shape is what
 * the guest cards already render and what `find`/`listClientGuests` return,
 * so it is shipped verbatim (see the migration header).
 */
export type ClientProfileRow = Views['client_guest_profiles']['Row']

export type RsvpStatus = Enums['rsvp_status']
export type CallOutcome = Enums['call_outcome']
export type TravelDirection = Enums['travel_direction']
export type TravelMode = Enums['travel_mode']
export type GroupType = Enums['group_type']
export type Side = Enums['side']
export type DeliverableKind = Enums['deliverable_kind']

/**
 * The four derived columns of `v_rsvp_queue`, pre-reduced server-side.
 *
 * NOT raw `call_attempts` rows: that table is append-only, so a family called
 * five times is five rows the phone would hold forever, and no screen renders
 * an individual attempt. These four numbers are what the queue actually
 * shows. `n` is `count(*)` — never a stored counter, per CLAUDE.md §5.4.
 */
export interface CallStatRow {
  groupId: string
  n: number
  lastAt: string | null
  lastOutcome: CallOutcome | null
  nextCallbackAt: string | null
}

/** The event header — `app.event_snapshot`'s `event` object. */
export interface EventHeader {
  id: string
  code: string
  name: string | null
  startsOn: string | null
  endsOn: string | null
  venueCity: string | null
  brideName: string | null
  groomName: string | null
  archivedAt: string | null
}

/** Who the snapshot was built for. Decides which screens can even exist. */
export type SnapshotRole = 'team' | 'client' | 'admin'

/**
 * The RAW payload, exactly as `app.event_snapshot` returns it.
 *
 * Every table array is optional because a CLIENT payload has the event
 * header, `client` and nothing else — the migration drops the staff arrays
 * entirely rather than sending empty ones, so a bug in the client app cannot
 * dress an empty staff array up as a loaded one. `v` is the payload version:
 * a client that does not recognise it must fall back rather than guess.
 */
export interface RawSnapshot {
  v?: number
  role?: string
  at?: string
  watermark?: string
  since?: string
  deletesSeen?: boolean
  event?: Partial<EventHeader> | null
  groups?: unknown
  guests?: unknown
  legs?: unknown
  callStats?: unknown
  hotels?: unknown
  rooms?: unknown
  assignments?: unknown
  deliverables?: unknown
  proofs?: unknown
  vehicles?: unknown
  vehicleTypes?: unknown
  trips?: unknown
  tripPassengers?: unknown
  drivers?: unknown
  vehicleAssignments?: unknown
  odometer?: unknown
  staff?: unknown
  client?: unknown
}

/** A `RawSnapshot` whose arrays have been validated and normalised. */
export interface SnapshotData {
  version: number
  role: SnapshotRole
  at: string | null
  watermark: string | null
  event: EventHeader | null
  groups: GroupRow[]
  guests: GuestRow[]
  legs: LegRow[]
  callStats: CallStatRow[]
  hotels: HotelRow[]
  rooms: RoomRow[]
  assignments: AssignmentRow[]
  deliverables: DeliverableRow[]
  proofs: ProofRow[]
  vehicles: VehicleRow[]
  vehicleTypes: VehicleTypeRow[]
  trips: TripRow[]
  tripPassengers: TripPassengerRow[]
  drivers: DriverRow[]
  vehicleAssignments: VehicleAssignmentRow[]
  odometer: OdometerRow[]
  staff: StaffRow[]
  client: ClientProfileRow[]
}

/**
 * The in-memory state the app reads through `useEventStore`.
 *
 * RECORDS, NOT ARRAYS, at the top level. Every screen looks a row up by id
 * (this room's occupants, this group's legs), and a `find()` over an array
 * per render is exactly the O(rooms × assignments) scan the old server read
 * had to avoid. Arrays are derived once per state object by `selectors.ts`
 * and memoised on the state's identity.
 */
export interface EventState {
  eventId: string
  /** 'store' means the snapshot RPC answered; 'fallback' means it does not exist. */
  mode: 'loading' | 'store' | 'fallback'
  role: SnapshotRole
  /** Hydration stage, for the one skeleton a screen is allowed to show. */
  status: 'empty' | 'ready' | 'error'
  /** Server watermark of the newest applied payload. Feeds changes_since. */
  watermark: string | null
  /** When the newest payload was built server-side. */
  at: string | null
  /** Last error that did NOT wipe the cache (a failed background catch-up). */
  error: string | null
  syncing: boolean
  /** ms since the last successful contact — drives the >30 s offline pill. */
  staleForMs: number | null
  event: EventHeader | null
  groups: Record<string, GroupRow>
  guests: Record<string, GuestRow>
  legs: Record<string, LegRow>
  callStats: Record<string, CallStatRow>
  hotels: Record<string, HotelRow>
  rooms: Record<string, RoomRow>
  assignments: Record<string, AssignmentRow>
  deliverables: Record<string, DeliverableRow>
  proofs: Record<string, ProofRow>
  vehicles: Record<string, VehicleRow>
  vehicleTypes: Record<string, VehicleTypeRow>
  trips: Record<string, TripRow>
  tripPassengers: Record<string, TripPassengerRow>
  drivers: Record<string, DriverRow>
  vehicleAssignments: Record<string, VehicleAssignmentRow>
  odometer: Record<string, OdometerRow>
  staff: Record<string, StaffRow>
  client: Record<string, ClientRecord>
  /** Rows the parser refused. Surfaced so a silent shape change is visible. */
  dropped: number
}

/**
 * A table's record map, so `applyOps` can copy exactly one of them.
 *
 * `pax` records the plural key the migration uses for the array (`legs`, not
 * `legRows`), which is what `mergeChanges` needs to read a delta.
 */
export type RecordKey =
  | 'groups'
  | 'guests'
  | 'legs'
  | 'callStats'
  | 'hotels'
  | 'rooms'
  | 'assignments'
  | 'deliverables'
  | 'proofs'
  | 'vehicles'
  | 'vehicleTypes'
  | 'trips'
  | 'tripPassengers'
  | 'drivers'
  | 'vehicleAssignments'
  | 'odometer'
  | 'staff'
  | 'client'

/**
 * The record maps addressable by `id`.
 *
 * `callStats` is excluded because its rows are keyed by `groupId` and have no
 * `id` at all — it gets its own two ops rather than a special case in every
 * generic helper. `client` rows are stored with an `id` mirroring `guest_id`
 * (see `EventState.client`) so they fit the same shape.
 */
export type RowKey = Exclude<RecordKey, 'callStats'>

/** `client_guest_profiles` rows carry no `id`; the store adds one. */
export type ClientRecord = ClientProfileRow & { id: string }

/**
 * A local, optimistic mutation of the store.
 *
 * OPS, NOT A WHOLE NEW STATE. Two reasons, and both are about correctness
 * rather than tidiness:
 *
 *   1. ROLLBACK. A refusal has to undo exactly the thing that was attempted.
 *      Restoring a snapshot of the previous state also throws away any OTHER
 *      optimistic write made in between — the documented flaw in
 *      `lib/mutate/optimistic.ts` `settle()`. Ops can be inverted against the
 *      state they were applied to, so undo touches only its own rows.
 *   2. TESTS. Every screen's write is a short list of ops, so the store's
 *      behaviour under a refusal is testable without a server.
 *
 * `*.patch` ops are typed per table, because a screen patches a couple of
 * fields and a typo there should not compile. `row.set` / `row.remove` are
 * generic over the record key, because the merge and a few screens hold a
 * whole row and a full-row op keeps the union small enough to invert totally.
 */
export type StoreOp =
  | { t: 'group.patch'; id: string; patch: Partial<GroupRow> }
  | { t: 'leg.patch'; id: string; patch: Partial<LegRow> }
  | { t: 'assignment.patch'; id: string; patch: Partial<AssignmentRow> }
  | { t: 'deliverable.patch'; id: string; patch: Partial<DeliverableRow> }
  | { t: 'vehicle.patch'; id: string; patch: Partial<VehicleRow> }
  | { t: 'trip.patch'; id: string; patch: Partial<TripRow> }
  | { t: 'staff.patch'; id: string; patch: Partial<StaffRow> }
  /** Insert or replace a whole row, addressed by `id`. */
  | { t: 'row.set'; key: RowKey; row: { id: string } }
  /** Remove a row. `id` is the map key. */
  | { t: 'row.remove'; key: RowKey; id: string }
  /**
   * Replace a group's call aggregate, or drop it (`stat: null`).
   *
   * `callStats` needs its own op rather than `row.set`, because its rows are
   * keyed by `groupId` and have no `id`: making it fit the generic shape would
   * mean inventing a field the migration does not send.
   */
  | { t: 'callStat.set'; groupId: string; stat: CallStatRow | null }
  | {
      /** Bump a group's call aggregate after a logged outcome. */
      t: 'callStat.bump'
      groupId: string
      at: string
      outcome: CallOutcome | null
      nextCallbackAt: string | null
      /** True for a dial with no outcome yet (`startCallAttempt`). */
      open?: boolean
    }

/** A persisted snapshot row in IndexedDB. */
export interface PersistedSnapshot {
  eventId: string
  savedAt: number
  watermark: string | null
  role: SnapshotRole
  data: SnapshotData
}
