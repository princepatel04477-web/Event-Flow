import { Capacitor } from '@capacitor/core'
import type { SupportedStorage } from '@supabase/supabase-js'

/**
 * Supabase auth storage that survives Android WebView cache clears.
 *
 * On native (Capacitor), the default localStorage adapter is cleared when
 * Android reclaims WebView storage or the user clears app cache — staff would
 * be logged out mid-event. Capacitor Preferences maps to Android
 * SharedPreferences, which survives cache clears.
 *
 * On the web (dev) we use localStorage so the app still works in a browser.
 *
 * The detection used to be `Boolean(window.Capacitor)`, described as "Capacitor
 * injects a global `Capacitor` only on native". That is not true — @capacitor/core
 * installs the global in the browser as well, so `isNative` was true everywhere
 * and the localStorage branch was dead code. It happened to still work because
 * the Preferences plugin has a web implementation that is itself localStorage,
 * just under a `CapacitorStorage.` key prefix. `isNativePlatform()` is the
 * supported check. Native behaviour is unchanged; browsers now use the branch
 * that was always intended for them (which costs one re-login, once).
 */
const isNative = typeof window !== 'undefined' && Capacitor.isNativePlatform()

function isPreferencesError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'message' in err &&
    String((err as { message: unknown }).message).includes('Capacitor')
  )
}

/**
 * Minimal SupportedStorage implementation. `getItem` returns null (not throw)
 * for a missing key so Supabase treats it as "no session" rather than an error.
 */
export const capacitorStorageAdapter: SupportedStorage = {
  async getItem(key: string): Promise<string | null> {
    if (!isNative) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    }
    try {
      const { Preferences } = await import('@capacitor/preferences')
      const { value } = await Preferences.get({ key })
      return value ?? null
    } catch (err) {
      // On the first run before the native bridge is ready, Capacitor
      // throws. Treat it as "no session" — never crash the client.
      if (isPreferencesError(err)) return null
      throw err
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (!isNative) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* storage full or blocked — nothing sane to do */
      }
      return
    }
    try {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.set({ key, value })
    } catch {
      /* ignore — a failed persist must not break the current session */
    }
  },

  async removeItem(key: string): Promise<void> {
    if (!isNative) {
      try {
        window.localStorage.removeItem(key)
      } catch {
        /* noop */
      }
      return
    }
    try {
      const { Preferences } = await import('@capacitor/preferences')
      await Preferences.remove({ key })
    } catch {
      /* noop */
    }
  },
}
