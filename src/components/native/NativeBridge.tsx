'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

import { dropLastVisit, getLanding, previousVisit, resolveBack } from '@/lib/nav/back'
import { closeTopSheet, openSheetCount } from '@/lib/nav/sheet-stack'
import { wireExternalLinkInterception } from '@/lib/native/navigation'
import { isNativePlatform } from '@/lib/native/platform'
import { initSentry } from '@/lib/sentry'

/**
 * A two-second note at the foot of the screen, in plain DOM. The back button
 * is a native event outside React, and this is the only thing it ever needs
 * to say, so it does not warrant a component or a store.
 */
function showExitNote() {
  const note = document.createElement('div')
  note.textContent = 'Press back again to close EventFlow'
  note.setAttribute('role', 'status')
  note.style.cssText =
    'position:fixed;left:50%;bottom:calc(var(--ef-tabbar-h) + env(safe-area-inset-bottom,0px) + 16px);' +
    'transform:translateX(-50%);z-index:70;padding:10px 16px;border-radius:999px;' +
    'background:var(--ef-now);color:var(--ef-now-fg);font-size:14px;font-weight:500;' +
    'white-space:nowrap;pointer-events:none'
  document.body.appendChild(note)
  window.setTimeout(() => note.remove(), 2000)
}

/**
 * Native bridge wiring — mounted once in the root layout.
 *
 * - appStateChange → refreshSession(): Android suspends JS timers in the
 *   background, so the auto-refresh interval stalls. Refresh on resume.
 * - backButton → `resolveBack` (UI4 N4): close the top sheet, else step back
 *   within the current tab, else go up from a detail screen, else go to the
 *   viewer's landing tab, else "press back again to close". It used to be a
 *   bare `history.back()`, which navigated away from under an open sheet,
 *   walked back through every tab switch, and exited from any deep-linked
 *   screen.
 *
 * Skipped entirely on the web, so this component is safe to render everywhere.
 * (The old guard tested for the `window.Capacitor` global and claimed it was
 * "absent on the web" — it is not; see lib/native/platform.ts.)
 */
export function NativeBridge() {
  const router = useRouter()
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])
  const lastExitPrompt = useRef<number | null>(null)

  // Browser bootstrap that must run on EVERY platform, and only in a browser.
  //
  // `initSentry()` and `wireExternalLinkInterception()` live here now. They used
  // to sit in src/app/layout.tsx inside `if (typeof window !== 'undefined')` —
  // but that file is a SERVER component, so `window` was always undefined there
  // and neither call ever reached the browser. Without the interceptor a tap on
  // any raw `tel:` anchor could navigate the WebView (the Tier-0 call bug)
  // instead of handing the dial to the OS, which is the whole reason the
  // interceptor exists.
  useEffect(() => {
    initSentry()
    wireExternalLinkInterception()
  }, [])

  useEffect(() => {
    if (!isNativePlatform()) return

    let handles: Array<{ remove: () => void }> = []

    async function init() {
      const [{ App }, { supabase }] = await Promise.all([
        import('@capacitor/app'),
        import('@/lib/supabase/client'),
      ])

      const stateHandle = await App.addListener('appStateChange', ({ isActive }) => {
        if (!isActive) return
        // A no-op for a code-auth (team/client) session — it has no GoTrue
        // refresh token — but correct for an admin.
        void supabase.auth.refreshSession()
        // Drain the offline queues on the NATIVE resume event. This is the
        // reliable trigger on Android; the queues' own `visibilitychange` drain
        // is not guaranteed to fire on every WebView resume, so queued writes and
        // proofs could otherwise sit until the next hard network flip. Skipped
        // while offline so a doomed attempt does not count a retry against every
        // queued row.
        if (typeof navigator === 'undefined' || navigator.onLine) {
          void import('@/lib/mutate/write-queue')
            .then((m) => m.flushWriteQueue())
            .catch(() => {})
          void import('@/lib/proof-queue')
            .then((m) => m.flushProofQueue())
            .catch(() => {})
        }
      })

      const backHandle = await App.addListener('backButton', ({ canGoBack }) => {
        const action = resolveBack({
          openSheets: openSheetCount(),
          current: window.location.pathname,
          // Only trust our own record of the previous screen when the WebView
          // agrees there is somewhere to go back to.
          previous: canGoBack ? previousVisit() : null,
          landing: getLanding(),
          lastExitPromptAt: lastExitPrompt.current,
          now: Date.now(),
        })

        switch (action.type) {
          case 'close-sheet':
            closeTopSheet()
            return
          case 'history-back':
            dropLastVisit()
            window.history.back()
            return
          case 'go':
            // Replace, not push: going UP must not leave the detail screen
            // behind it in history, or the next back would return to it.
            dropLastVisit()
            routerRef.current.replace(action.href)
            return
          case 'confirm-exit':
            lastExitPrompt.current = Date.now()
            showExitNote()
            return
          case 'exit':
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
