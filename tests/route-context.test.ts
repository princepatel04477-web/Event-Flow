import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * route_context() — the ONE call behind a staff screen (S2).
 *
 * `server-only` throws on import outside a React Server Component graph, so it
 * is neutralised exactly as `tests/v3-calls-screens.test.ts` does.
 *
 * REACT'S `cache()` IS STOOD IN FOR, AND WHY. `perRequest` (src/lib/request-cache.ts)
 * is backed by React's `cache()`, which is scoped to a render pass. There is no
 * render pass in vitest, so React hands out a fresh store per call and
 * "asked once" would be untestable. The stand-in below has the SAME contract —
 * one store per cached factory — so the real `perRequest` runs unchanged and
 * what these tests prove is the real thing: three callers (layout, page, guard)
 * produce ONE rpc call.
 */
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  return {
    ...actual,
    cache: (factory: unknown) => {
      const value = (factory as () => unknown)()
      return () => value
    },
  }
})

vi.mock('server-only', () => ({}))

vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}))

const rpcMock = vi.fn()
const maybeSingleMock = vi.fn()
const getClaimsMock = vi.fn(async () => ({ data: { claims: { sub: null } } }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    rpc: rpcMock,
    auth: { getClaims: getClaimsMock },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: maybeSingleMock }),
        order: () => ({ maybeSingle: maybeSingleMock }),
      }),
    }),
  }),
}))

/** No code-auth session; these tests are about routing, not identity. */
vi.mock('@/lib/auth/server', () => ({
  getSessionClaims: async () => null,
}))

const { getRouteContext, toRouteContext, isMissingFunctionError, __resetRouteContextDetection } =
  await import('@/lib/route-context')

const rpcPayload = {
  event: {
    id: 'evt-1',
    code: 'SAMPLE2026',
    name: 'Sample Event',
    starts_on: '2026-12-01',
    ends_on: '2026-12-03',
    venue_city: 'Surat',
    is_active: true,
  },
  access: 'event_team',
  department: 'hospitality',
}

beforeEach(() => {
  rpcMock.mockReset()
  maybeSingleMock.mockReset()
  __resetRouteContextDetection()
})

describe('toRouteContext', () => {
  it('narrows a well-formed RPC answer', () => {
    const ctx = toRouteContext(rpcPayload)
    expect(ctx).not.toBeNull()
    expect(ctx!.event?.id).toBe('evt-1')
    expect(ctx!.access).toBe('event_team')
    expect(ctx!.department).toBe('hospitality')
    expect(ctx!.source).toBe('rpc')
  })

  it('refuses a payload with no event, rather than inventing one', () => {
    expect(toRouteContext(null)).toBeNull()
    expect(toRouteContext({ access: 'admin' })).toBeNull()
  })

  it('refuses an unknown access value', () => {
    expect(toRouteContext({ ...rpcPayload, access: 'superuser' })).toBeNull()
  })

  it('drops a department it does not recognise instead of passing it through', () => {
    expect(toRouteContext({ ...rpcPayload, department: 'catering' })!.department).toBeNull()
  })
})

describe('isMissingFunctionError', () => {
  it('recognises PostgREST PGRST202 and a bare 404', () => {
    expect(isMissingFunctionError({ code: 'PGRST202' })).toBe(true)
    expect(isMissingFunctionError({ code: '404' })).toBe(true)
    expect(
      isMissingFunctionError({ message: 'Could not find the function public.route_context' }),
    ).toBe(true)
  })

  it('does NOT treat a transient error as a missing function', () => {
    expect(isMissingFunctionError({ code: '500', message: 'internal error' })).toBe(false)
    expect(isMissingFunctionError(null)).toBe(false)
  })
})

describe('getRouteContext', () => {
  it('answers the whole request with ONE rpc call', async () => {
    rpcMock.mockResolvedValue({ data: rpcPayload, error: null })

    // The layout, then the page, then a guard — all in the same request.
    const layout = await getRouteContext('ONCE-A')
    const page = await getRouteContext('ONCE-A')
    const guard = await getRouteContext('ONCE-A')

    expect(layout.event?.id).toBe('evt-1')
    expect(page.access).toBe('event_team')
    expect(guard.department).toBe('hospitality')
    expect(rpcMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the existing helpers when the RPC is not deployed', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.route_context' },
    })
    maybeSingleMock.mockResolvedValue({
      data: { id: 'evt-2', code: 'FALLBACK-A', name: 'Sample Event' },
      error: null,
    })

    const ctx = await getRouteContext('FALLBACK-A')
    expect(ctx.source).toBe('fallback')
    expect(ctx.event?.id).toBe('evt-2')
  })

  it('stops asking for a function that does not exist', async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.route_context' },
    })
    maybeSingleMock.mockResolvedValue({
      data: { id: 'evt-3', code: 'STOP-A', name: 'Other' },
      error: null,
    })

    await getRouteContext('STOP-A')
    rpcMock.mockClear()
    await getRouteContext('STOP-B')

    expect(rpcMock).not.toHaveBeenCalled()
  })
})
