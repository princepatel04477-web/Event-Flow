import { type NextRequest } from 'next/server'

import { updateSession } from '@/lib/supabase/middleware'

export async function proxy(request: NextRequest) {
  return await updateSession(request)
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
