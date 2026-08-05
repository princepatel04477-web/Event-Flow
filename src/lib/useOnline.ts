'use client'

import { useSyncExternalStore } from 'react'

/**
 * Global online/offline state (M9 Part A).
 *
 * On native, drives off @capacitor/network so Android's connectivity state
 * is the source of truth. On the web, falls back to the browser's online/
 * offline events. Exposed via useSyncExternalStore so any component gets a
 * live value with no prop drilling.
 */

// Server renders the "online" state so hydration always matches. The real
// value snaps in from the browser/native listeners immediately after mount —
// before that, `useOnline()` reports true (no offline banner flash).
let online = true
const listeners = new Set<() => void>()

function setOnline(next: boolean) {
  if (online === next) return
  online = next
  listeners.forEach((l) => l())
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function getSnapshot(): boolean {
  return online
}

/** Wire the native Network plugin once. */
async function initNativeNetwork() {
  if (typeof window === 'undefined' || !(window as any).Capacitor) return
  try {
    const { Network } = await import('@capacitor/network')
    const status = await Network.getStatus()
    setOnline(status.connected)
    Network.addListener('networkStatusChange', (s) => setOnline(s.connected))
  } catch {
    /* native network unavailable — fall back to browser events */
  }
}

// Browser online/offline events always work as a base layer.
if (typeof window !== 'undefined') {
  setOnline(navigator.onLine)
  window.addEventListener('online', () => setOnline(true))
  window.addEventListener('offline', () => setOnline(false))
  void initNativeNetwork()
}

/** Hook: true when the device currently has a network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}

export default useOnline
