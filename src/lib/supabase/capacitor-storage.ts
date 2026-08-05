import type { SupportedStorage } from '@supabase/supabase-js'

/**
 * Supabase auth storage that survives Android WebView cache clears.
 *
 * On native (Capacitor), the default localStorage adapter is cleared when
 * Android reclaims WebView storage or the user clears app cache — staff would
 * be logged out mid-event. Capacitor Preferences maps to Android
 * SharedPreferences, which survives cache clears.
 *
 * On the web (dev, non-Capacitor) we fall back to localStorage so the app
 * still works in a browser. Detection is feature-based: Capacitor injects a
 * global `Capacitor` only on native.
 */
const isNative = typeof window !== 'undefined' && Boolean((window as any).Capacitor)

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
