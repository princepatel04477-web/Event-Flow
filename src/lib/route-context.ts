import 'server-only'

import { getStaffViewerContext } from '@/lib/auth/section-guard'
import { isStaffDepartment, type StaffDepartment } from '@/lib/departments'
import { perRequest, seedPerRequest } from '@/lib/request-cache'
import { createClient } from '@/lib/supabase/server'
import { getEventAccess, resolveEventByCode, type EventAccess } from '@/lib/supabase/queries'

/** The events row, as `resolveEventByCode` returns it. */
export type RouteEvent = NonNullable<Awaited<ReturnType<typeof resolveEventByCode>>>

/** What every staff route needs before it can render, in one answer. */
export interface RouteContext {
  event: RouteEvent | null
  access: EventAccess
  department: StaffDepartment | null
  /** Which resolver answered. Not rendered — read by the report and the test. */
  source: 'rpc' | 'fallback'
}

const RPC_NAME = 'route_context'

/**
 * Does this database have `route_context()` yet?
 *
 * `null` = not asked. Once the RPC answers (or answers with "no such
 * function") the verdict is REMEMBERED, so a deployment that ships before the
 * migration pays the failed lookup exactly once per process, not once per
 * request. A transient error (a 500, a timeout) does NOT set it to false —
 * that would disable the fast path for the life of the process because of one
 * bad minute.
 */
let rpcSupported: boolean | null = null

/** Test seam: forget the remembered verdict. */
export function __resetRouteContextDetection(): void {
  rpcSupported = null
}

type RpcError = { code?: string; message?: string } | null

/**
 * PostgREST answers a missing function with PGRST202 ("Could not find the
 * function ... in the schema cache"). Some proxies surface it as a plain 404.
 * Both mean "the migration has not been applied".
 */
export function isMissingFunctionError(error: RpcError): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '404') return true
  return /could not find the function|does not exist/i.test(error.message ?? '')
}

/**
 * Narrow the RPC's jsonb answer into a RouteContext.
 *
 * Exported and pure so the mapping can be tested without a database. A payload
 * that is missing the event or carries an unknown access is treated as "no
 * answer" (null) rather than guessed at — the fallback path then re-resolves
 * it honestly.
 */
export function toRouteContext(data: unknown): RouteContext | null {
  if (!data || typeof data !== 'object') return null
  const raw = data as { event?: unknown; access?: unknown; department?: unknown }

  const e = raw.event as { id?: unknown; code?: unknown } | undefined
  if (!e || typeof e.id !== 'string' || typeof e.code !== 'string') return null

  if (raw.access !== 'admin' && raw.access !== 'event_team' && raw.access !== 'client') {
    return null
  }

  const department =
    typeof raw.department === 'string' && isStaffDepartment(raw.department)
      ? (raw.department as StaffDepartment)
      : null

  return {
    event: raw.event as RouteEvent,
    access: raw.access,
    department,
    source: 'rpc',
  }
}

async function loadViaRpc(eventCode: string): Promise<RouteContext | 'unsupported'> {
  if (rpcSupported === false) return 'unsupported'

  const supabase = await createClient()
  // The generated Database type predates this function (the migration is not
  // applied yet). One cast here is cheaper than editing a generated file by
  // hand; it disappears the moment `npm run types:gen` runs after the push.
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: RpcError }>

  try {
    const { data, error } = await rpc(RPC_NAME, { p_event_code: eventCode })

    if (error) {
      if (isMissingFunctionError(error)) {
        rpcSupported = false
      }
      return 'unsupported'
    }

    rpcSupported = true
    // A null answer is a real one: "this viewer cannot see this event".
    return toRouteContext(data) ?? { event: null, access: 'none', department: null, source: 'rpc' }
  } catch {
    return 'unsupported'
  }
}

/**
 * Put the one answer where every existing caller already looks.
 *
 * The event row and the access are exactly the values `resolveEventByCode` and
 * `getEventAccess` memoise, so seeding their keys means the layout and the page
 * — and `requireSection` inside the page — all read this one result instead of
 * asking the database again. See `seedPerRequest`.
 */
function seedResolution(ctx: RouteContext, requestedCode: string): void {
  if (!ctx.event) return
  seedPerRequest(`event:${requestedCode}`, ctx.event)
  seedPerRequest(`event:${ctx.event.code}`, ctx.event)
  seedPerRequest(`access:${ctx.event.id}`, ctx.access)
}

/** The pre-migration path: the same three calls, in the same order as today. */
async function loadViaHelpers(eventCode: string): Promise<RouteContext> {
  const event = await resolveEventByCode(eventCode)
  if (!event) return { event: null, access: 'none', department: null, source: 'fallback' }

  const staffCtx = await getStaffViewerContext(event.id)
  // getStaffViewerContext returns null for a client and for nobody alike; only
  // getEventAccess can tell those apart, so ask it for the non-staff case.
  const access: EventAccess = staffCtx ? staffCtx.access : await getEventAccess(event.id)

  return { event, access, department: staffCtx?.department ?? null, source: 'fallback' }
}

/**
 * Everything a v2 layout or page needs to render, resolved ONCE per request.
 *
 * `perRequest` is React's request-scoped memo (see `src/lib/request-cache.ts`),
 * which is why the layout, the page and `requireSection` share one answer
 * instead of three. It is used rather than a bare `cache()` on the lookup for
 * the reason that file records: a previous attempt cached nullish lookups and
 * turned a transient miss into a sticky "you are not signed in".
 */
export function getRouteContext(eventCode: string): Promise<RouteContext> {
  return perRequest(`route-context:${eventCode}`, async () => {
    const viaRpc = await loadViaRpc(eventCode)
    if (viaRpc !== 'unsupported') {
      seedResolution(viaRpc, eventCode)
      return viaRpc
    }
    return loadViaHelpers(eventCode)
  })
}
