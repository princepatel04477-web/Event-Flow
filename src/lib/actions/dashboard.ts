'use server'

import { createClient } from '@/lib/supabase/server'
import { perRequest } from '@/lib/request-cache'
import { PERF_BASELINE } from '@/lib/supabase/queries'
import { ttlCache } from '@/lib/ttl-cache'

// Dashboard counters are 30s-stale at worst. Every row of this module pays
// a ~150ms round-trip to the Supabase region; the numbers do not change
// between two glances, so a short TTL turns repeated visits into instant
// renders. Keyed by eventId — one event's counts never leak into another's.
const cache30 = ttlCache<unknown>(30_000)

/** Per-phase server-side timing for the dashboard reads (instrument-first). */
function phaseTiming(label: string) {
  const marks: Record<string, number> = {}
  let last = performance.now()
  return {
    mark(name: string) {
      const now = performance.now()
      marks[name] = Math.round(now - last)
      last = now
    },
    report() {
      const parts = Object.entries(marks).map(([k, v]) => `${k}:${v}ms`)
      console.log(`[perf] ${label} phases :: ${parts.join(' · ')}`)
    },
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export interface DashboardRow {
  eventId: string
  name: string
  totalGroups: number
  totalPax: number
  rsvpConfirmed: number
  rsvpPending: number
  arrivalsToday: number
  departuresToday: number
  guestsRoomed: number
  hampersDelivered: number
  hampersPending: number
  returnGiftsDelivered: number
  logisticsExpense: number
}

/**
 * The board's counters AND its attention rows, in ONE round trip.
 *
 * These were two reads of two views (`v_event_dashboard`, `v_event_attention`)
 * on every dashboard load. Both scan `events`, both compute `hampers_pending`,
 * and each cost a full round trip to Seoul — ~150-320ms apiece, against a
 * query that executes in single-digit ms. `v_event_board` (migration
 * 20260809120000) returns both sets of columns as one row.
 *
 * FALLBACK. If that migration has not been applied yet the read fails with
 * PostgREST's undefined_table, and this falls back to the original two views,
 * remembering the decision for the life of the process so the failure is paid
 * once rather than on every load. Deploy order stays free: old view + new
 * code is still correct, just one trip slower.
 */

/**
 * Read `v_event_board` through a hand-written shim.
 *
 * `database.types.ts` is GENERATED (`npm run types:gen`) and only lists the
 * relations that existed when it was last regenerated, so it does not know
 * about v_event_board until migration 20260809120000 is applied and the types
 * are regenerated. Rather than hand-edit a generated file — which the next
 * regeneration would silently discard — this narrows the client to the exact
 * call shape used, and nothing wider.
 *
 * Delete this and use `supabase.from('v_event_board')` directly once
 * `npm run types:gen` has run against a database that has the view.
 */
type BoardQueryResult = {
  data: Record<string, unknown> | null
  error: { code?: string; message?: string } | null
}

type UntypedFrom = {
  from: (relation: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => { maybeSingle: () => Promise<BoardQueryResult> }
    }
  }
}

function selectBoardRow(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
): Promise<BoardQueryResult> {
  return (supabase as unknown as UntypedFrom)
    .from('v_event_board')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle()
}

type BoardRow = DashboardRow & AttentionRow

/** Set once v_event_board is known to be absent, to stop re-probing it. */
let boardViewMissing = false

export async function readBoard(eventId: string): Promise<BoardRow | null> {
  const key = `board:${eventId}`

  // Per-request first: one render must never read this twice.
  return perRequest(key, async () => {
    const hit = PERF_BASELINE ? undefined : (cache30.get(key) as BoardRow | null | undefined)
    if (hit !== undefined) return hit

    const supabase = await createClient()
    const timing = phaseTiming('dashboard :: v_event_board')

    if (!boardViewMissing) {
      const { data, error } = await selectBoardRow(supabase, eventId)
      timing.mark('request')

      if (!error && data) {
        const row = projectBoard(data as Record<string, unknown>)
        cache30.set(key, row)
        timing.report()
        return row
      }

      // "This view has not been created yet" vs "the read failed". Getting
      // this wrong is not cosmetic: the first version of this check looked
      // only for 42P01 / "does not exist", but PostgREST answers an unknown
      // relation with PGRST205 and the wording "Could not find the table
      // 'public.v_event_board' in the schema cache". That fell through to the
      // failure branch, readDashboard returned null, and the board rendered
      // its "Could not load the numbers" card on every load.
      //
      // PGRST205 is PostgREST's schema-cache miss; 42P01 is Postgres'
      // undefined_table, which is what a direct SQL path would raise. Accept
      // both. Any OTHER error is a genuine read failure and must still be
      // reported as one rather than silently falling back.
      const missing =
        error?.code === 'PGRST205' ||
        error?.code === '42P01' ||
        /does not exist|could not find the table/i.test(error?.message ?? '')
      if (!missing) {
        timing.report()
        return null
      }
      boardViewMissing = true
      console.warn(
        '[dashboard] v_event_board missing — using the two legacy views. Apply ' +
          'supabase/migrations/20260809120000_board_view.sql to halve this round trip.',
      )
    }

    // Legacy path: the original two views, in parallel rather than in series.
    const [{ data: dash }, { data: attn }] = await Promise.all([
      supabase.from('v_event_dashboard').select('*').eq('event_id', eventId).maybeSingle(),
      supabase.from('v_event_attention').select('*').eq('event_id', eventId).maybeSingle(),
    ])
    timing.mark('legacy-request')
    timing.report()

    if (!dash) return null
    const row = projectBoard({
      ...(dash as Record<string, unknown>),
      ...((attn ?? {}) as Record<string, unknown>),
    })
    cache30.set(key, row)
    return row
  })
}

/** Map the snake_case columns onto the camelCase shape the UI expects. */
function projectBoard(d: Record<string, unknown>): BoardRow {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0)
  return {
    eventId: d.event_id as string,
    name: d.name as string,
    totalGroups: n(d.total_groups),
    totalPax: n(d.total_pax),
    rsvpConfirmed: n(d.rsvp_confirmed),
    rsvpPending: n(d.rsvp_pending),
    arrivalsToday: n(d.arrivals_today),
    departuresToday: n(d.departures_today),
    guestsRoomed: n(d.guests_roomed),
    hampersDelivered: n(d.hampers_delivered),
    hampersPending: n(d.hampers_pending),
    returnGiftsDelivered: n(d.return_gifts_delivered),
    logisticsExpense: n(d.logistics_expense),
    confirmedNoRoom: n(d.confirmed_no_room),
    arrivalsNoVehicle: n(d.arrivals_no_vehicle),
    noDeparture: n(d.no_departure),
  }
}

export async function readDashboard(eventId: string): Promise<DashboardRow | null> {
  return readBoard(eventId)
}
// ---------------------------------------------------------------------------
// Today panel — arrivals/departures detail
// ---------------------------------------------------------------------------

export interface TodayLeg {
  legId: string
  direction: 'arrival' | 'departure'
  travelTime: string | null
  mode: string | null
  reference: string | null
  point: string | null
  paxOnLeg: number | null
  headName: string
  totalPax: number
  hasVehicle: boolean
}

export async function readTodayLegs(
  eventId: string,
  date: string,
): Promise<{ arrivals: TodayLeg[]; departures: TodayLeg[] }> {
  const supabase = await createClient()

  const { data: legs } = await supabase
    .from('travel_legs')
    .select(`
      id, direction, travel_time, mode, reference, point, pax_on_leg,
      group_id,
      guest_groups!inner(head_name, coalesce(confirmed_pax, expected_pax))
    `)
    .eq('event_id', eventId)
    .eq('travel_date', date)
    .order('travel_time', { ascending: true })

  const rows = (legs ?? []) as unknown as Array<{
    id: string
    direction: string
    travel_time: string | null
    mode: string | null
    reference: string | null
    point: string | null
    pax_on_leg: number | null
    group_id: string
    guest_groups: { head_name: string; coalesce: number }
  }>

  // Check vehicle assignment: look up trip_passengers for these groups
  const groupIds = [...new Set(rows.map((r) => r.group_id))]
  let vehicleSet = new Set<string>()
  if (groupIds.length > 0) {
    const { data: assigned } = await supabase
      .from('trip_passengers')
      .select('group_id')
      .eq('event_id', eventId)
      .in('group_id', groupIds)

    vehicleSet = new Set((assigned ?? []).map((a) => a.group_id))
  }

  const arrivals: TodayLeg[] = []
  const departures: TodayLeg[] = []

  for (const r of rows) {
    const leg: TodayLeg = {
      legId: r.id,
      direction: r.direction as 'arrival' | 'departure',
      travelTime: r.travel_time,
      mode: r.mode,
      reference: r.reference,
      point: r.point,
      paxOnLeg: r.pax_on_leg,
      headName: r.guest_groups?.head_name ?? 'Unknown',
      totalPax: r.guest_groups?.coalesce ?? 0,
      hasVehicle: vehicleSet.has(r.group_id),
    }
    if (r.direction === 'arrival') arrivals.push(leg)
    else departures.push(leg)
  }

  return { arrivals, departures }
}

// ---------------------------------------------------------------------------
// Attention panel
// ---------------------------------------------------------------------------

export interface AttentionRow {
  confirmedNoRoom: number
  arrivalsNoVehicle: number
  noDeparture: number
  hampersPending: number
}

export async function readAttention(eventId: string): Promise<AttentionRow> {
  const board = await readBoard(eventId)
  // Zeros are the honest answer on a failed read: the attention panel means
  // "nothing needs doing", and the counters above it already render the
  // load-failure state when readDashboard returns null.
  return {
    confirmedNoRoom: board?.confirmedNoRoom ?? 0,
    arrivalsNoVehicle: board?.arrivalsNoVehicle ?? 0,
    noDeparture: board?.noDeparture ?? 0,
    hampersPending: board?.hampersPending ?? 0,
  }
}