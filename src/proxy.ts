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
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|html|apk|xlsx)$).*)',
  ],
}
