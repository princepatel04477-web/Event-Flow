'use client'

import { Capacitor } from '@capacitor/core'

/**
 * True only inside the Capacitor WebView (the APK) — false in any browser.
 *
 * The whole codebase used to test `Boolean(window.Capacitor)`. That check is
 * WRONG: `@capacitor/core` installs a `window.Capacitor` global on the web too,
 * so every browser reported itself as native. Code then took the native branch,
 * called a plugin that only exists in the APK, and relied on a `catch` to fall
 * back — which works only where a fallback was written, and hides real native
 * failures where one was not.
 *
 * `Capacitor.isNativePlatform()` is the supported check: it compares the
 * resolved platform to 'web' rather than sniffing for a global.
 *
 * Guarded for SSR — every caller is a client component, but these modules are
 * still evaluated during server rendering.
 */
export function isNativePlatform(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

/** 'android' | 'ios' | 'web'. Useful for platform-specific UI affordances. */
export function nativePlatform(): string {
  if (typeof window === 'undefined') return 'web'
  try {
    return Capacitor.getPlatform()
  } catch {
    return 'web'
  }
}
