'use client'

import { useCallback, useSyncExternalStore } from 'react'

import { isNativePlatform } from '@/lib/native/platform'

/**
 * Per-DEVICE UI memory for the new group: "has this already been shown here?"
 *
 * ── Why this is not localStorage on the APK ───────────────────────────────
 * The brief is explicit, and the reason is in this codebase already: a WebView
 * remount can take localStorage with it. Android reclaims WebView storage under
 * pressure, `tel:` backgrounds the app on every call, and the native session
 * keeper (`src/lib/native/session-keeper.ts`) exists precisely because a lost
 * store logs people out mid-event. Capacitor Preferences maps to Android
 * SharedPreferences, which survives all of it. On the web it is localStorage,
 * which is the honest equivalent there — the same two branches the storage
 * adapter in `src/lib/supabase/capacitor-storage.ts` already takes, copied
 * rather than invented a second time.
 *
 * ── Why the value is cached in the module ─────────────────────────────────
 * The alternative — a `useEffect` that sets state after an async read — renders
 * the wrong thing first and corrects it a frame later. On this screen that
 * means a returning staff member seeing the first-run cards flash and vanish,
 * which is worse than not showing them. So the read starts at module import,
 * the value is served synchronously from the snapshot, and nothing renders
 * until the read has settled (`useDeviceFlag` returns `undefined` until then).
 * Every caller treats `undefined` as "not yet" and renders nothing.
 *
 * ── Why the write is not awaited ──────────────────────────────────────────
 * This is a one-shot UI flag, not field data. Blocking a dismissal on a
 * SharedPreferences round trip would put a network-shaped delay behind a tap
 * (docs/INTERACTION-CONTRACT.md T1/T2), for a value whose worst failure is
 * showing a one-line hint twice. The write is optimistic and allowed to lose.
 *
 * KEY NAMES. `nuvent.welcome.played` is FROZEN (CLAUDE.md §12) and is NOT
 * touched here: it is the cold-start splash marker, owned by
 * `src/lib/motion/cold-start.ts`, and it means "this app launch", not "this
 * device, ever". Every key below is new and additive; nothing existing is
 * renamed or migrated.
 */

/** Prefix for every key this module owns. */
const PREFIX = 'nuvent.v2.'

/** The three first-run cards. Never shown twice on one device. */
export const FIRST_RUN_KEY = `${PREFIX}onboarded`

/** One key per screen hint, so a hint can be dismissed on its own. */
export function hintKey(screen: string): string {
  return `${PREFIX}hint.${screen}`
}

/** One settled answer: `value` is the stored string, or null when unset. */
interface Entry {
  value: string | null
}

/**
 * Not yet read. This exact object is also the SERVER snapshot, and that is the
 * point: the server has no device and no preferences, so it renders the same
 * "not yet" the client's first render does. Both sides agree, nothing hydrates
 * differently, and there is no flash of a wrong answer either way.
 */
const NOT_YET: Entry = { value: null }

/** The settled answer for a key the device has never stored. */
const UNSET: Entry = { value: null }

let cache = new Map<string, Entry>()
let loaded = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** One stable snapshot object per key, so `Object.is` on it means "changed". */
function entryFor(key: string): Entry {
  if (!loaded) return NOT_YET
  return cache.get(key) ?? UNSET
}

/**
 * The client snapshot. Note there is no `typeof window` branch: an unloaded
 * store answers NOT_YET on the server and on the client alike, which is what
 * keeps hydration identical. A missing key answers with the DISTINCT `UNSET`
 * object, so "read has settled and there is no flag" can never be confused with
 * "read has not settled" — the whole reason `undefined` is reserved for the
 * second one.
 */
function getSnapshot(key: string): Entry {
  return entryFor(key)
}

function getServerSnapshot(): Entry {
  return NOT_YET
}

/**
 * Read every key this module owns, once per app launch.
 *
 * `Preferences.keys()` (not a fixed list) because the hint keys are one per
 * screen, and a hardcoded list would silently stop matching the moment a screen
 * is added — the flag would then read as "never shown" and that hint would
 * reappear on every launch forever.
 */
async function load(): Promise<void> {
  const next = new Map<string, Entry>()
  try {
    if (!isNativePlatform()) {
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i)
        if (key && key.startsWith(PREFIX)) next.set(key, { value: window.localStorage.getItem(key) })
      }
    } else {
      const { Preferences } = await import('@capacitor/preferences')
      const { keys } = await Preferences.keys()
      for (const key of keys) {
        if (!key.startsWith(PREFIX)) continue
        const { value } = await Preferences.get({ key })
        next.set(key, { value: value ?? null })
      }
    }
  } catch {
    // Blocked or broken storage fails to an EMPTY set, never a "shown" one. Empty
    // means the cards and the hints are offered again — a small annoyance. The
    // other direction would mean they never appear at all for the device that
    // needs them, and never appearing is the failure this session exists to
    // prevent.
  }
  cache = next
  loaded = true
  emit()
}

if (typeof window !== 'undefined') {
  void load()
}

/** Persist, best effort. Never throws, never awaited by the caller. */
function put(key: string, value: string): void {
  cache = new Map(cache).set(key, { value })
  emit()

  if (!isNativePlatform()) {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      /* storage full or blocked — the in-memory value still applies this launch */
    }
    return
  }

  void import('@capacitor/preferences')
    .then(({ Preferences }) => Preferences.set({ key, value }))
    .catch(() => {
      /* the flag reappears next launch; see the header for why that is the safe way to lose */
    })
}

/**
 * The stored value for a key, or `undefined` until the read has settled.
 *
 * `undefined` is NOT "false" — it is "this device has not answered yet", and
 * every caller must render nothing for it. See the header.
 */
export function useDeviceFlag(key: string): string | null | undefined {
  const entry = useSyncExternalStore(
    subscribe,
    () => getSnapshot(key),
    getServerSnapshot,
  )
  return entry === NOT_YET ? undefined : entry.value
}

/** Write a flag. A component reading that key re-renders immediately. */
export function useSetDeviceFlag(): (key: string, value: string) => void {
  return useCallback((key: string, value: string) => put(key, value), [])
}
