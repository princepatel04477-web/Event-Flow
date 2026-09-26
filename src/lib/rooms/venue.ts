'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * The Rooms board's venue preference — which hotel the coordinator last looked
 * at, remembered on this device.
 *
 * WHY A DEVICE PREFERENCE AND NOT A COLUMN. Which venue you are standing in is
 * a property of the shift, not of the event: one coordinator spends the morning
 * at the Grand and the afternoon at the Ashoka, and the other coordinator on
 * the same event is at neither. There is nowhere honest to store it server-side,
 * so it is localStorage — and localStorage throws in Safari private mode and
 * when the quota is full, so every access is wrapped. A preference that cannot
 * be read is not an error; it just means show every venue.
 *
 * The pure helpers take a `Storage`-shaped argument so they are unit-testable
 * without a DOM; `useStoredVenue` is the React edge.
 */

/** Minimal surface of `localStorage`, so tests can pass a stub. */
export interface VenueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Per event, because the same device opens different events. */
export function venueStorageKey(eventId: string): string {
  return `ef.rooms.venue.${eventId}`
}

/** The stored venue id, or null. Never throws. */
export function readStoredVenue(storage: VenueStorage | null | undefined, eventId: string): string | null {
  if (!storage) return null
  try {
    const value = storage.getItem(venueStorageKey(eventId))
    return value && value.length > 0 ? value : null
  } catch {
    return null
  }
}

/** Persist the chosen venue (null clears it). Never throws. */
export function writeStoredVenue(
  storage: VenueStorage | null | undefined,
  eventId: string,
  venueId: string | null,
): void {
  if (!storage) return
  try {
    if (venueId) storage.setItem(venueStorageKey(eventId), venueId)
    else storage.removeItem(venueStorageKey(eventId))
  } catch {
    // Private mode / quota — the preference is a nicety, not the feature.
  }
}

/** `window.localStorage`, or null when there is no window. */
function browserStorage(): VenueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * The chosen venue for this event, read from the device once on mount and
 * written back on every change. The first render is always `null` (all venues)
 * so the server render and the client's first paint agree.
 */
export function useStoredVenue(eventId: string): [string | null, (venueId: string | null) => void] {
  const [venueId, setVenueId] = useState<string | null>(null)

  useEffect(() => {
    setVenueId(readStoredVenue(browserStorage(), eventId))
  }, [eventId])

  const choose = useCallback(
    (next: string | null) => {
      setVenueId(next)
      writeStoredVenue(browserStorage(), eventId, next)
    },
    [eventId],
  )

  return [venueId, choose]
}
