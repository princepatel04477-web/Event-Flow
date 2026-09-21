import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Guards the flag that swaps the whole UI, and the one Next constraint that
 * shaped how it is wired.
 *
 * `docs/UI2-PROMPTS.md` §2 planned `src/app/(app)/[eventCode]/...` beside
 * `src/app/(staff)/[eventCode]/...`. Next refuses it — a route group does not
 * appear in the URL, so both pages resolve to `/[eventCode]` and the build dies
 * with E28 ("You cannot have two parallel pages that resolve to the same
 * path"). It fails in the route graph, before any of our code runs, and
 * typecheck, eslint and this whole suite stay green through it. So the new
 * screens live at a real internal segment, `/v2/...`, and the proxy below is
 * the only thing that maps a phone's URL onto them.
 *
 * These cases exist because that mapping has three failure modes that no other
 * test in the repo can see, and each of them is silent:
 *
 *   1. The rewrite does not fire. v2 quietly serves the old app and every
 *      screen in the new group is dead code that still builds and still passes.
 *   2. v1 is rewritten "for symmetry". The legacy app then depends on a rewrite
 *      staying correct to keep working, which is not what "unchanged" means.
 *   3. `/v2` is missing from the exclusion list, so the rewrite's own output
 *      matches the rule and loops.
 */

let updateSessionImpl: (req: NextRequest) => Promise<NextResponse>

vi.mock('@/lib/supabase/middleware', () => ({
  updateSession: (req: NextRequest) => updateSessionImpl(req),
}))

const { proxy } = await import('@/proxy')

function request(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, 'http://localhost:3000'))
}

/** The header Next itself reads to perform a rewrite. */
function rewrittenTo(response: NextResponse): string | null {
  const raw = response.headers.get('x-middleware-rewrite')
  return raw ? new URL(raw).pathname : null
}

/** The same, query string included — the part `pathname` alone loses. */
function rewrittenSearch(response: NextResponse): string {
  const raw = response.headers.get('x-middleware-rewrite')
  return raw ? new URL(raw).search : ''
}

beforeEach(() => {
  updateSessionImpl = async () => NextResponse.next()
  delete process.env.NEXT_PUBLIC_UI
})

describe('the UI flag', () => {
  it('defaults to v1, so an env var that never got set cannot half-enable the new UI', async () => {
    const { getUiVersion } = await import('@/lib/ui-version')
    expect(getUiVersion()).toBe('v1')

    process.env.NEXT_PUBLIC_UI = 'anything-else'
    expect(getUiVersion()).toBe('v1')

    process.env.NEXT_PUBLIC_UI = 'v2'
    expect(getUiVersion()).toBe('v2')
  })
})

describe('proxy rewrite, NEXT_PUBLIC_UI=v2', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_UI = 'v2'
  })

  it('sends an event-scoped screen to the new group', async () => {
    expect(rewrittenTo(await proxy(request('/SAMPLE2026')))).toBe('/v2/SAMPLE2026')
    expect(rewrittenTo(await proxy(request('/SAMPLE2026/rsvp/queue')))).toBe(
      '/v2/SAMPLE2026/rsvp/queue',
    )
    // Deep and dynamic, because the new group has both.
    expect(rewrittenTo(await proxy(request('/SAMPLE2026/rsvp/status/abc-123')))).toBe(
      '/v2/SAMPLE2026/rsvp/status/abc-123',
    )
  })

  it('carries the query string across, so ?denied= and every filtered link survives', async () => {
    const response = await proxy(request('/SAMPLE2026?denied=import'))
    expect(rewrittenTo(response)).toBe('/v2/SAMPLE2026')
    expect(rewrittenSearch(response)).toBe('?denied=import')
  })

  it('does not touch a route that is not an event screen', async () => {
    for (const path of [
      '/',
      '/login',
      '/pick-staff',
      '/admin/events',
      '/api/version',
      '/debug',
      '/design-system',
      '/auth/callback',
      // The one that matters most: the rewrite's own output must not match the
      // rule that produced it, or the request never reaches a page.
      '/v2/SAMPLE2026',
      '/v2/SAMPLE2026/rsvp/queue',
    ]) {
      expect(rewrittenTo(await proxy(request(path))), path).toBeNull()
    }
  })
})

describe('proxy rewrite, v1', () => {
  it('passes the legacy app through untouched — no rewrite at all, not a rewrite to itself', async () => {
    const response = await proxy(request('/SAMPLE2026/guests/list'))

    expect(rewrittenTo(response)).toBeNull()
    // A pass-through still returns updateSession's own response, so the session
    // cookie it refreshes survives.
    expect(response.status).toBe(200)
  })
})

describe('the session refresh is never lost to the rewrite', () => {
  it('carries Set-Cookie from updateSession onto the rewritten response', async () => {
    process.env.NEXT_PUBLIC_UI = 'v2'
    updateSessionImpl = async () => {
      const r = NextResponse.next()
      r.cookies.set('nuvent_code_auth', 'kept', { path: '/' })
      return r
    }

    const response = await proxy(request('/SAMPLE2026'))
    expect(rewrittenTo(response)).toBe('/v2/SAMPLE2026')
    expect(response.cookies.get('nuvent_code_auth')?.value).toBe('kept')
  })

  it('honours a redirect from updateSession instead of rewriting over it', async () => {
    process.env.NEXT_PUBLIC_UI = 'v2'
    updateSessionImpl = async () =>
      NextResponse.redirect(new URL('/login?next=%2FSAMPLE2026', 'http://localhost:3000'))

    const response = await proxy(request('/SAMPLE2026'))
    expect(response.status).toBe(307)
    expect(response.headers.get('location')).toContain('/login')
    expect(rewrittenTo(response)).toBeNull()
  })
})
