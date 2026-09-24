import { supabase } from '@/lib/supabase/client'

import { fetchEventChanges, fetchEventSnapshot } from './client'
import { readCachedSnapshot, writeCachedSnapshot } from './db'
import { applyOps, invertOps, mergeChanges } from './reducer'
import { parseSnapshot, stateFromSnapshot, emptyState } from './snapshot'
import type { EventState, GroupRow, PersistedSnapshot, SnapshotData, StoreOp } from './types'

/**
 * The store engine: one per open event, framework-agnostic.
 *
 * WHY IT IS NOT A HOOK. Everything that decides what a runner sees — when to
 * hydrate, when to catch up, whether a realtime row is trustworthy, how a
 * refusal is undone — is ordinary imperative logic over an immutable state
 * object. Driving it from React effects would make the one part that must be
 * exactly right the one part that cannot be tested without a DOM. So the
 * engine is a plain class with `getState`/`subscribe`, and
 * `src/lib/store/useEventStore.ts` is a thin `useSyncExternalStore` wrapper.
 *
 * THE FOUR WAYS STATE CHANGES, and they are deliberately different:
 *
 *   1. HYDRATE  — IndexedDB, before any network. This is the one that makes
 *                 reopening the app paint in a frame.
 *   2. SNAPSHOT — the full RPC, on cold start, on resume after a long gap, and
 *                 periodically while running (because a DELTA CANNOT SEE A
 *                 DELETE — see `event_changes_since`).
 *   3. DELTA    — `event_changes_since` on reconnect, on resume, and when
 *                 realtime reports a change to a table whose value is DERIVED
 *                 (`call_attempts` → the queue's four aggregate columns).
 *   4. LOCAL    — optimistic ops from a tap, reverted by their inverse if the
 *                 server refuses (see `reducer.ts`).
 *
 * REALTIME IS PARTIAL, AND THE ENGINE IS HONEST ABOUT IT. The
 * `supabase_realtime` publication contains exactly two tables
 * (20260731000800): `guest_groups` and `call_attempts`. A `guest_groups` event
 * carries the whole row, so it is patched in with no round trip at all. A
 * `call_attempts` event cannot be — the queue's `attempt_count`/`last_outcome`
 * are aggregates over rows the phone does not hold — so it schedules a delta
 * instead. Every OTHER table (rooms, assignments, deliverables, travel_legs,
 * vehicles, trips, staff) reaches the phone through the resume/periodic
 * catch-up, not through realtime. Adding them to the publication is a
 * one-line-per-table follow-up and is called out in the job report; it is
 * deliberately NOT in this migration, which is additive functions only.
 */

/** How long a realtime-triggered delta is coalesced before it is sent. */
export const REALTIME_DEBOUNCE_MS = 800

/** While running, take a full snapshot this often — a delta cannot see deletes. */
export const RESYNC_AFTER_MS = 10 * 60_000

/** Backgrounded longer than this and the app catches up before painting. */
export const RESUME_AFTER_MS = 60_000

/** Silence longer than this and the one small pill appears. */
export const STALE_PILL_AFTER_MS = 30_000

/** Ticks the stale clock so the pill can appear without a state change. */
const STALE_TICK_MS = 5_000

type Listener = () => void

interface RealtimePayload {
  eventType?: string
  new?: Record<string, unknown>
  old?: Record<string, unknown>
}

/** A group row as realtime sends it: the table's columns, `event_id` included. */
function groupFromRealtime(row: Record<string, unknown>): GroupRow | null {
  const id = row.id
  if (typeof id !== 'string' || id.length === 0) return null
  // `event_id` and `source_row_hash` are stripped for the same reason the
  // migration strips them: the store's rows carry neither, and a row that had
  // them would be a different shape from every row a snapshot produced.
  const copy: Record<string, unknown> = { ...row }
  delete copy.event_id
  delete copy.source_row_hash
  return copy as unknown as GroupRow
}

export interface StagedStoreWrite {
  /** Undo exactly these ops, leaving any later write alone. */
  revert: () => void
}

export interface EngineOptions {
  /** Disable the RPC for tests that only exercise local behaviour. */
  offline?: boolean
  now?: () => number
  /** Injected for tests; defaults to the real event_snapshot/catch-up calls. */
  load?: (eventId: string) => Promise<SnapshotLoad>
  loadChanges?: (eventId: string, since: string) => Promise<SnapshotLoad>
  /** Skip IndexedDB (unit tests, and any environment without it). */
  persist?: boolean
  /** Skip the realtime channel (unit tests). */
  realtime?: boolean
}

export interface SnapshotLoad {
  ok: boolean
  payload?: unknown
  unsupported: boolean
  message: string
}

interface ResolvedOptions {
  now: () => number
  persist: boolean
  realtime: boolean
  offline?: boolean
  load?: (eventId: string) => Promise<SnapshotLoad>
  loadChanges?: (eventId: string, since: string) => Promise<SnapshotLoad>
}

export class EventStoreEngine {
  readonly eventId: string

  private state: EventState
  private listeners = new Set<Listener>()
  private started = false
  private stopped = false
  private readonly options: ResolvedOptions

  /** Serialises network work so two catch-ups cannot race their watermarks. */
  private inFlight: Promise<void> | null = null
  /** Guards against an older snapshot overwriting a newer one. */
  private seq = 0
  private realtimeTimer: ReturnType<typeof setTimeout> | null = null
  private resyncTimer: ReturnType<typeof setInterval> | null = null
  private staleTimer: ReturnType<typeof setInterval> | null = null
  private channel: { unsubscribe: () => void } | null = null
  private hiddenAt: number | null = null
  private lastOkAt: number | null = null
  /** Set once the database has told us the function does not exist. */
  private rpcDisabled = false
  private onVisible: (() => void) | null = null

  constructor(eventId: string, options: EngineOptions = {}) {
    this.eventId = eventId
    this.options = {
      now: () => Date.now(),
      persist: true,
      realtime: true,
      ...options,
    }
    this.state = emptyState(eventId)
  }

  /* ---------------------------------------------------------------- */
  /* The external-store surface                                        */
  /* ---------------------------------------------------------------- */

  getState = (): EventState => this.state

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(patch: Partial<EventState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  start(): void {
    if (this.started || this.stopped) return
    this.started = true

    // NOT awaited: the cache read races the first paint on purpose. A hit
    // paints from IndexedDB in a frame; a miss leaves the skeleton up until the
    // snapshot lands. Nothing here blocks the render that mounted us.
    void this.hydrate()

    if (this.options.realtime && typeof window !== 'undefined') {
      this.subscribeRealtime()
      this.onVisible = () => this.handleVisibility()
      document.addEventListener('visibilitychange', this.onVisible)
      // A full resync on a timer, because a delta cannot see a delete. Ten
      // minutes is a compromise: often enough that a room deleted at 9am is
      // gone by 9:10, rare enough that it is ~1% of the traffic the old
      // screens generated.
      this.resyncTimer = setInterval(() => void this.revalidate(), RESYNC_AFTER_MS)
    }
  }

  stop(): void {
    this.stopped = true
    this.started = false
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    if (this.resyncTimer) clearInterval(this.resyncTimer)
    if (this.staleTimer) clearInterval(this.staleTimer)
    this.realtimeTimer = null
    this.resyncTimer = null
    this.staleTimer = null
    if (this.channel) {
      this.channel.unsubscribe()
      this.channel = null
    }
    if (this.onVisible && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.onVisible)
      this.onVisible = null
    }
    this.listeners.clear()
  }

  /* ---------------------------------------------------------------- */
  /* 1. Hydrate                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Paint the cached event, then go and find out what changed.
   *
   * The catch-up is chosen by AGE, not by habit: a cache from five minutes ago
   * is caught up with a delta (small, fast); a cache from before the shift
   * started is replaced outright, because a delta cannot see the deletes that
   * happened overnight.
   */
  private async hydrate(): Promise<void> {
    if (this.options.persist) {
      const cached = await readCachedSnapshot(this.eventId)
      if (cached && !this.stopped) {
        this.applySnapshot(cached.data, cached.savedAt)
        const age = this.options.now() - cached.savedAt
        if (age > RESYNC_AFTER_MS) {
          void this.revalidate()
        } else {
          void this.catchUp()
        }
        return
      }
    }
    await this.revalidate()
  }

  /** Take a parsed snapshot into state, without touching the network. */
  private applySnapshot(data: SnapshotData, savedAt: number): void {
    const next = stateFromSnapshot(this.eventId, data)
    // `staleForMs` is measured from the PAYLOAD's age, not from "we just
    // loaded it": a cache read at 09:00 that was written at 07:00 is two hours
    // stale and the pill should say so.
    const age = Math.max(0, this.options.now() - savedAt)
    this.lastOkAt = savedAt
    this.state = {
      ...next,
      staleForMs: age > STALE_PILL_AFTER_MS ? age : null,
    }
    this.notify()
    this.ensureStaleClock()
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /* ---------------------------------------------------------------- */
  /* 2. Full snapshot                                                   */
  /* ---------------------------------------------------------------- */

  /** One call, the whole event. Replaces every table. */
  async revalidate(): Promise<void> {
    if (this.stopped || this.rpcDisabled || this.options.offline) return
    return this.serialise(async () => {
      const seq = ++this.seq
      this.setState({ syncing: true })

      const loader = this.options.load ?? defaultLoad
      const result = await loader(this.eventId)
      if (this.stopped || seq !== this.seq) return

      if (!result.ok) {
        this.handleFailure(result.unsupported, result.message)
        return
      }

      const parsed = parseSnapshot(result.payload)
      if (!parsed) {
        // The RPC answered, so the function IS deployed — but with a payload
        // this build cannot read (a newer version). Do not flip to fallback:
        // the old reads are not more correct, and the screens must not thrash.
        //
        // `mode: 'store'` is set even though the payload was refused, and that
        // is the point of this branch. `mode` answers "which read path owns the
        // screens"; the RPC answered, so the store owns them. Leaving `mode` at
        // its initial 'loading' would strand every screen on a skeleton while
        // the honest message sat in `error` that nothing renders.
        this.setState({
          mode: 'store',
          syncing: false,
          error: 'This app is older than the server data.',
        })
        return
      }

      const savedAt = this.options.now()
      this.state = { ...stateFromSnapshot(this.eventId, parsed.data, parsed.dropped) }
      this.lastOkAt = savedAt
      this.notify()
      this.setState({ staleForMs: null, error: null })
      this.ensureStaleClock()

      if (this.options.persist) {
        const persisted: PersistedSnapshot = {
          eventId: this.eventId,
          savedAt,
          watermark: parsed.data.watermark,
          role: parsed.data.role,
          data: parsed.data,
        }
        void writeCachedSnapshot(persisted)
      }
    })
  }

  /* ---------------------------------------------------------------- */
  /* 3. Delta                                                          */
  /* ---------------------------------------------------------------- */

  /** Everything that changed since the last watermark. Cheap; called freely. */
  async catchUp(): Promise<void> {
    if (this.stopped || this.rpcDisabled || this.options.offline) return
    const since = this.state.watermark
    // No watermark means no snapshot has landed yet. A delta against
    // `-infinity` would be a full table dump with no ordering guarantee, so the
    // full snapshot is the honest call here.
    if (!since) return this.revalidate()

    return this.serialise(async () => {
      const seq = ++this.seq
      this.setState({ syncing: true })

      const loader = this.options.loadChanges ?? defaultLoadChanges
      const result = await loader(this.eventId, since)
      if (this.stopped || seq !== this.seq) return

      if (!result.ok) {
        this.handleFailure(result.unsupported, result.message)
        return
      }

      const parsed = parseSnapshot(result.payload)
      if (!parsed) {
        this.setState({ syncing: false })
        return
      }

      const merged = mergeChanges(this.state, parsed.data, parsed.dropped)
      const savedAt = this.options.now()
      this.lastOkAt = savedAt
      this.state = { ...merged, syncing: false, error: null, staleForMs: null }
      this.notify()
      this.ensureStaleClock()

      if (this.options.persist) {
        // Persist the merged state, not the delta: a cold start must not have
        // to replay a chain of deltas, and the chain is not kept.
        void writeCachedSnapshot({
          eventId: this.eventId,
          savedAt,
          watermark: merged.watermark,
          role: merged.role,
          data: dataOf(merged),
        })
      }
    })
  }

  private handleFailure(unsupported: boolean, message: string): void {
    if (unsupported) {
      // The database does not have the RPC. Stop trying for this session: the
      // screens fall back to the reads they had before this job existed.
      this.rpcDisabled = true
      if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
      if (this.resyncTimer) clearInterval(this.resyncTimer)
      this.realtimeTimer = null
      this.resyncTimer = null
      this.setState({ mode: 'fallback', syncing: false, status: 'ready', error: null })
      return
    }

    // STALE IS NOT THE SAME AS UNTOUCHED, and the difference is the whole
    // reason the offline pill exists. When a revalidation fails but cached rows
    // are on screen, the age of the last GOOD contact is a fact the runner
    // needs: the board still renders, and the pill is the only thing that says
    // the numbers may have moved. Reporting `null` there — which an earlier
    // version did by measuring "ms since the last contact" — would hide the one
    // signal that distinguishes "nothing has changed" from "this phone cannot
    // reach Seoul". So the age is reported whenever there is a last-good
    // contact, even a young one.
    const age = this.lastOkAt === null ? null : this.options.now() - this.lastOkAt
    this.setState({
      syncing: false,
      error: message,
      ...(age === null ? {} : { staleForMs: age }),
      // No data at all and the store cannot load it: hand the screens back to
      // their server reads so they can show their own, honest error state
      // rather than an empty screen. A later success flips straight back.
      ...(this.lastOkAt === null ? { mode: 'fallback' as const, status: 'ready' as const } : {}),
    })
    this.ensureStaleClock()
  }

  private ensureStaleClock(): void {
    if (typeof window === 'undefined') return
    const wanted = this.state.staleForMs !== null
    if (wanted && !this.staleTimer) {
      this.staleTimer = setInterval(() => {
        if (this.lastOkAt === null) return
        this.setState({ staleForMs: this.options.now() - this.lastOkAt })
      }, STALE_TICK_MS)
    } else if (!wanted && this.staleTimer) {
      clearInterval(this.staleTimer)
      this.staleTimer = null
    }
  }

  /* ---------------------------------------------------------------- */
  /* 4. Local optimistic writes                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Apply ops now; hand back the undo.
   *
   * The inverse is computed against the state BEFORE the ops, so a refusal
   * undoes its own rows and nothing else — see `invertOps` for why that is not
   * a snapshot restore.
   */
  stage(ops: readonly StoreOp[]): StagedStoreWrite {
    const before = this.state
    if (ops.length > 0) {
      this.state = applyOps(before, ops)
      this.notify()
    }
    const inverse = invertOps(before, ops)
    return {
      revert: () => {
        if (inverse.length === 0) return
        this.state = applyOps(this.state, inverse)
        this.notify()
      },
    }
  }

  /** Patch one row from a realtime event. No round trip. */
  applyRealtimeGroup(payload: RealtimePayload): void {
    if (payload.eventType === 'DELETE') {
      const id = payload.old?.id
      if (typeof id === 'string') this.stage([{ t: 'row.remove', key: 'groups', id }])
      return
    }
    const row = payload.new ? groupFromRealtime(payload.new) : null
    if (row) this.stage([{ t: 'row.set', key: 'groups', row }])
  }

  /* ---------------------------------------------------------------- */
  /* Realtime + resume                                                 */
  /* ---------------------------------------------------------------- */

  private subscribeRealtime(): void {
    const channel = supabase
      .channel(`event-store-${this.eventId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'guest_groups',
          filter: `event_id=eq.${this.eventId}`,
        },
        (payload: unknown) => this.applyRealtimeGroup(payload as RealtimePayload),
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'call_attempts',
          filter: `event_id=eq.${this.eventId}`,
        },
        // The queue's attempt_count / last_outcome / next_callback_at are
        // aggregates over rows the phone does not hold, so this event cannot
        // be applied — it can only say "ask again". Debounced, because logging
        // an outcome writes a call_attempts row AND closes it a moment later.
        () => this.scheduleCatchUp(),
      )
      .subscribe()

    this.channel = {
      unsubscribe: () => {
        void supabase.removeChannel(channel)
      },
    }
  }

  private scheduleCatchUp(): void {
    if (this.realtimeTimer) clearTimeout(this.realtimeTimer)
    this.realtimeTimer = setTimeout(() => {
      this.realtimeTimer = null
      void this.catchUp()
    }, REALTIME_DEBOUNCE_MS)
  }

  /**
   * The app was backgrounded and is back.
   *
   * THIS IS THE IMPORTANT ONE. `tel:` backgrounds the WebView on EVERY call
   * (CLAUDE.md §12), so this fires dozens of times an hour during a calling
   * shift; a long gap is the moment the phone is most likely to be behind, and
   * a short one is not worth a request.
   */
  private handleVisibility(): void {
    if (typeof document === 'undefined') return
    const now = this.options.now()

    if (document.visibilityState === 'hidden') {
      this.hiddenAt = now
      return
    }

    const hiddenFor = this.hiddenAt === null ? 0 : now - this.hiddenAt
    this.hiddenAt = null
    if (hiddenFor < RESUME_AFTER_MS) return

    if (hiddenFor > RESYNC_AFTER_MS) {
      void this.revalidate()
    } else {
      void this.catchUp()
    }
  }

  /** Test seam: run one visibility transition without a DOM. */
  resumeAfter(hiddenForMs: number): void {
    if (hiddenForMs > RESYNC_AFTER_MS) void this.revalidate()
    else if (hiddenForMs >= RESUME_AFTER_MS) void this.catchUp()
  }

  /* ---------------------------------------------------------------- */

  private serialise(work: () => Promise<void>): Promise<void> {
    const run = (this.inFlight ?? Promise.resolve()).then(work, work)
    this.inFlight = run.catch(() => undefined)
    return this.inFlight
  }
}

/** The production loaders, wired to the RPC wrappers. */
async function defaultLoad(eventId: string): Promise<SnapshotLoad> {
  const result = await fetchEventSnapshot(eventId)
  return result.ok
    ? { ok: true, payload: result.payload, unsupported: false, message: '' }
    : { ok: false, unsupported: result.unsupported, message: result.message }
}

async function defaultLoadChanges(eventId: string, since: string): Promise<SnapshotLoad> {
  const result = await fetchEventChanges(eventId, since)
  return result.ok
    ? { ok: true, payload: result.payload, unsupported: false, message: '' }
    : { ok: false, unsupported: result.unsupported, message: result.message }
}

/** The state's record maps, back as the arrays a persisted snapshot holds. */
function dataOf(state: EventState): SnapshotData {
  return {
    version: 1,
    role: state.role,
    at: state.at,
    watermark: state.watermark,
    event: state.event,
    groups: Object.values(state.groups),
    guests: Object.values(state.guests),
    legs: Object.values(state.legs),
    callStats: Object.values(state.callStats),
    hotels: Object.values(state.hotels),
    rooms: Object.values(state.rooms),
    assignments: Object.values(state.assignments),
    deliverables: Object.values(state.deliverables),
    proofs: Object.values(state.proofs),
    vehicles: Object.values(state.vehicles),
    vehicleTypes: Object.values(state.vehicleTypes),
    trips: Object.values(state.trips),
    tripPassengers: Object.values(state.tripPassengers),
    drivers: Object.values(state.drivers),
    vehicleAssignments: Object.values(state.vehicleAssignments),
    odometer: Object.values(state.odometer),
    staff: Object.values(state.staff),
    client: Object.values(state.client),
  }
}
