'use client'

import { Preferences } from '@capacitor/preferences'

import { isNativePlatform } from '@/lib/native/platform'

/**
 * Light / Dark / System (M2).
 *
 * LIGHT IS THE DEFAULT, deliberately. Staff read these screens in daylight, in
 * hotel lobbies and car parks; a dark default would be the wrong answer for the
 * majority and would only be changed back by the people who noticed the toggle.
 *
 * STORED TWICE, ON PURPOSE. `@capacitor/preferences` is the durable copy on a
 * handset; `localStorage` is the copy an inline script can read BEFORE the
 * first paint, which is what stops a dark-mode user seeing a white flash on
 * cold start. Neither is trusted as a security value — it is a display
 * preference — so a failure to read either is simply "light".
 */
export type ThemeMode = 'light' | 'dark' | 'system'

/** The resolved mode actually applied to the document. */
export type AppliedMode = 'light' | 'dark'

const STORAGE_KEY = 'eventflow:theme-mode'

/** Ground colours, mirrored into <meta name="theme-color"> per mode. */
const THEME_COLOR: Record<AppliedMode, string> = {
  light: '#f7f3ec',
  dark: '#0d0f10',
}

/** The inline script in the root layout reads the same key. Keep them in step. */
export const THEME_STORAGE_KEY = STORAGE_KEY

function isMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system'
}

function readLocal(): ThemeMode | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return isMode(raw) ? raw : null
  } catch {
    return null
  }
}

function writeLocal(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Private mode — the preference simply does not survive the session.
  }
}

/** What the user chose. Defaults to light, never to the OS setting. */
export async function readMode(): Promise<ThemeMode> {
  const local = typeof window === 'undefined' ? null : readLocal()
  if (local) return local

  if (typeof window !== 'undefined' && isNativePlatform()) {
    try {
      const { value } = await Preferences.get({ key: STORAGE_KEY })
      if (isMode(value)) {
        writeLocal(value)
        return value
      }
    } catch {
      // Fall through to the default.
    }
  }

  return 'light'
}

/** 'system' resolves against the OS, live. */
export function resolveMode(mode: ThemeMode): AppliedMode {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function applyToDocument(applied: AppliedMode): void {
  const root = document.documentElement
  if (applied === 'dark') root.setAttribute('data-mode', 'dark')
  else root.removeAttribute('data-mode')

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[applied])
  else {
    const created = document.createElement('meta')
    created.setAttribute('name', 'theme-color')
    created.setAttribute('content', THEME_COLOR[applied])
    document.head.appendChild(created)
  }
}

/**
 * Put a mode on the document, the status bar and the browser chrome.
 *
 * The status bar style is the inverse of the ground: Style.Dark is dark TEXT
 * (for a light ground), Style.Light is light text. The plugin is only present
 * on a handset, so this is a no-op on web and needs no APK rebuild — the
 * StatusBar plugin is already installed and registered.
 */
export async function applyMode(mode: ThemeMode): Promise<void> {
  const applied = resolveMode(mode)
  applyToDocument(applied)

  if (isNativePlatform()) {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar')
      await StatusBar.setStyle({ style: applied === 'dark' ? Style.Light : Style.Dark })
      await StatusBar.setBackgroundColor({ color: THEME_COLOR[applied] })
    } catch {
      // A StatusBar the OS refuses to restyle is cosmetic; never fatal.
    }
  }
}

/** Persist the choice, then apply it. */
export async function setMode(mode: ThemeMode): Promise<void> {
  writeLocal(mode)
  if (isNativePlatform()) {
    try {
      await Preferences.set({ key: STORAGE_KEY, value: mode })
    } catch {
      // localStorage still holds it; the durable copy is best-effort.
    }
  }
  await applyMode(mode)
}

/**
 * Follow the OS while the mode is 'system'.
 *
 * Returns an unsubscribe function. A no-op when the mode is not 'system', so a
 * caller can subscribe unconditionally.
 */
export function watchSystemMode(onChange: (applied: AppliedMode) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const listener = () => onChange(query.matches ? 'dark' : 'light')
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
