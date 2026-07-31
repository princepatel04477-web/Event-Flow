/**
 * sessionStorage bookkeeping for the in-flight call attempt.
 *
 * THE CENTRAL TRAP: `tel:` backgrounds the browser and Android may discard
 * page state entirely. The call_attempts row is written server-side BEFORE
 * the dial fires; this module is only the breadcrumb that lets the page find
 * that row again when the browser comes back. It is not the source of truth
 * — `attempts` fetched fresh from the server on every page load is — but it
 * lets us skip straight to the outcome screen instead of re-showing the dial
 * button and risking a second attempt row for the same call.
 */
'use client'

export interface StoredCallAttempt {
  attemptId: string
  groupId: string
  eventId: string
  dialedNumber: string
  startedAt: string // ISO, as returned by the server insert
}

function key(groupId: string): string {
  return `eventflow:call-attempt:${groupId}`
}

export function getStoredAttempt(groupId: string): StoredCallAttempt | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(key(groupId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCallAttempt
    if (!parsed?.attemptId) return null
    return parsed
  } catch {
    return null
  }
}

export function setStoredAttempt(entry: StoredCallAttempt): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(key(entry.groupId), JSON.stringify(entry))
  } catch {
    // Private-browsing quota or storage disabled — the server row is already
    // written, so the call is not lost, only the fast-resume convenience.
  }
}

export function clearStoredAttempt(groupId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(key(groupId))
  } catch {
    // Nothing to do — see setStoredAttempt.
  }
}
