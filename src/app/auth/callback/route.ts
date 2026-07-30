import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { safeRedirectPath } from '@/lib/utils'

/**
 * PKCE callback: exchanges the `?code=` Supabase put on the link for a real
 * session cookie, then forwards to `?next=`.
 *
 * Used by magic links, invites and password recovery. Failures land back on
 * /login with a friendly `?error=` rather than a stack trace — an expired
 * invite is an ordinary Tuesday, not an exception.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const origin = resolveOrigin(request, url)

  const next = safeRedirectPath(url.searchParams.get('next'))
  const code = url.searchParams.get('code')
  const providerError =
    url.searchParams.get('error_description') ?? url.searchParams.get('error')

  if (providerError || !code) {
    return NextResponse.redirect(`${origin}/login?error=link`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=link`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}

/**
 * Behind a proxy (Vercel, a tunnel, the APK's dev host) `request.url` is the
 * internal address. Trust the forwarded headers in production only.
 */
function resolveOrigin(request: NextRequest, url: URL): string {
  if (process.env.NODE_ENV !== 'production') return url.origin

  const forwardedHost = request.headers.get('x-forwarded-host')
  if (!forwardedHost) return url.origin

  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  return `${proto}://${forwardedHost}`
}
