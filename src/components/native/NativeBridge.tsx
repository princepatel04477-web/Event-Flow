'use client'

import { useEffect } from 'react'

/**
 * Native bridge wiring — mounted once in the root layout.
 *
 * - appStateChange → refreshSession(): Android suspends JS timers in the
 *   background, so the auto-refresh interval stalls. Refresh on resume.
 * - backButton → navigate back through history; exit only at the root. This
 *   overrides the default "any back press kills the app" behaviour.
 *
 * Both are no-ops on the web (the Capacitor global is absent), so this
 * component is safe to render everywhere.
 */
export function NativeBridge() {
  useEffect(() => {
    if (typeof window === 'undefined' || !(window as any).Capacitor) return

    let handles: Array<{ remove: () => void }> = []

    async function init() {
      const [{ App }, { supabase }] = await Promise.all([
        import('@capacitor/app'),
        import('@/lib/supabase/client'),
      ])

      const stateHandle = await App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          void supabase.auth.refreshSession()
        }
      })

      const backHandle = await App.addListener('backButton', ({ canGoBack }) => {
        if (canGoBack) {
          window.history.back()
        } else {
          void App.exitApp()
        }
      })

      handles = [stateHandle, backHandle]
    }

    void init()

    return () => {
      handles.forEach((h) => h.remove())
      handles = []
    }
  }, [])

  return null
}

export default NativeBridge
