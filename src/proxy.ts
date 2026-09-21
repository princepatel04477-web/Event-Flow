import { NextResponse, type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

import { getUiVersion } from '@/lib/ui-version'

/**
 * Paths that are NOT an event-scoped screen. A rewrite is only ever applied to
 * the rest.
 *
 * `/v2` is the load-bearing entry and it is the one that is easy to miss: it is
 * the internal prefix the new UI actually lives at (see INTERNAL_PREFIX below),
 * so without it a rewritten request would be rewritten again, forever.
 */
const NON_EVENT_PREFIXES = [
  '/login',
  '/admin',
  '/auth',
  '/pick-staff',
  '/api',
  '/debug',
  '/design-system',
  '/v2',
  '/_next',
]

/**
 * Where the new UI lives.
 *
 * NOT a route group. The V-series plan called for `src/app/(app)/[eventCode]`
 * beside `src/app/(staff)/[eventCode]`, selected by this rewrite. Next rejects
 * it: a route group does not appear in the URL, so those two pages resolve to
 * the same path `/[eventCode]` and the build dies with E28, "You cannot have
 * two parallel pages that resolve to the same path". That failure is in the
 * route graph, before any of our code runs.
 *
 * So the new screens sit under a real segment nothing links to, and the rewrite
 * below is what maps the URL a phone actually uses onto them. The runner's
 * address bar is unchanged — `/{event}/rsvp/queue` — and `(staff)` keeps
 * serving v1 untouched.
 */
const INTERNAL_PREFIX = '/v2'

function isEventScopedPath(pathname: string): boolean {
  if (!pathname || pathname === '/') return false
  return !NON_EVENT_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

export async function proxy(request: NextRequest) {
  const sessionResponse = await updateSession(request)

  // If updateSession redirected (e.g. to /login), honour it immediately.
  if (sessionResponse.headers.has('location')) {
    return sessionResponse
  }

  const { pathname } = request.nextUrl

  // v1 is the untouched app: `(staff)` already owns these paths, so the correct
  // action is no action at all. Rewriting v1 to `/(staff)/...` would have been
  // a change to the thing that must not change.
  if (getUiVersion() !== 'v2' || !isEventScopedPath(pathname)) {
    return sessionResponse
  }

  // The search string is carried across by hand. `nextUrl.pathname` excludes it,
  // and dropping it would silently break `?denied=` on the bounced-admin note
  // plus every filtered list the new screens link to.
  const response = NextResponse.rewrite(
    new URL(`${INTERNAL_PREFIX}${pathname}${request.nextUrl.search}`, request.url),
  )

  // updateSession may have refreshed the session cookie. A rewrite is a new
  // response object, so those Set-Cookie headers have to be carried over by
  // hand or every refresh is silently dropped.
  for (const cookie of sessionResponse.cookies.getAll()) {
    response.cookies.set(cookie)
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Auth routes are handled
     * inside updateSession() rather than excluded here, so the session cookie
     * still gets refreshed while sitting on /login.
     *
     * `xlsx` is here for the blank import template. It is a static asset with
     * no data in it — two invented example families — and the import screen
     * links it with `download`. Left matched, the proxy 307s it to /login and
     * the download silently yields a login page saved as a .xlsx, which opens
     * as garbage. Confirmed: it returned 307 before this was added.
     *
     * `html` and `apk` are in the exclusion list for a specific reason:
     * `public/install.html` is the page staff open to INSTALL the app, and it
     * was being matched here and 307'd to /login?next=%2Finstall.html. The
     * people that page exists for have no app and no session yet, so the auth
     * wall made the only distribution surface unreachable by exactly its
     * audience — and it fails at the worst moment, with staff standing there
     * holding a phone. `offline.html` (the Capacitor errorPath) is the same
     * shape, and an `.apk` served from a static host must not need a session
     * either. No App Router route ends in either extension, so excluding them
     * costs nothing.
     *
     * `manifest.webmanifest` is excluded for the same reason as install.html,
     * and it is easy to miss because it is generated (src/app/manifest.ts) and
     * so does not look like a static file. The browser fetches it to decide
     * what an "add to home screen" install is called and which icon it gets,
     * and it does that on the FIRST visit — before any session exists. Matched,
     * it 307s to /login, the fetch yields HTML, the manifest is discarded, and
     * the phone installs a shortcut named after the page title with a
     * screenshot for an icon. Measured: 307 to /login?next=%2Fmanifest.webmanifest
     * before this was added. It contains nothing private — a name, two colours
     * and three icon paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html|apk|xlsx)$).*)',
  ],
}
