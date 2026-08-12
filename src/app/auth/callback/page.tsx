'use client'

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase/client'

/**
 * PKCE callback — client-side, for static export.
 * Exchanges the ?code= for a session via the browser Supabase client,
 * which writes the cookie in the WebView directly.
 */
export default function AuthCallbackPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) {
      router.replace('/login?error=link')
      return
    }

    void (async () => {
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        router.replace('/login?error=link')
        return
      }
      const next = searchParams.get('next')
      router.replace(next ? next : '/')
    })()
  }, [router, searchParams])

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper">
      <p className="text-muted">Signing you in…</p>
    </div>
  )
}
