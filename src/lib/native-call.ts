'use client'

import { dialTarget, type DialTarget } from '@/lib/phone'
import { openExternalUrl } from '@/lib/native/navigation'
import { isNativePlatform } from '@/lib/native/platform'

/**
 * The ONE place a call is placed. M6.
 *
 * This module used to be dead code — a stale copy of logic that had been
 * inlined into CallScreen, and the two had already drifted (this one still did
 * a raw `window.location.href`, the screen used `openExternalUrl`, and
 * `handleRedial` used a third path that never touched the native plugin). Every
 * dial now goes through `placeCall` so there is a single behaviour to reason
 * about and fix.
 *
 * On native: the CallPlugin, which gives direct dial (no confirm screen once
 * CALL_PHONE is granted) plus call-state events. On the web, or if the plugin
 * throws: the system handoff, which opens the phone's dialer.
 */

/**
 * The number to actually dial, fully qualified.
 *
 * `DialTarget.dialedNumber` is deliberately the bare 10 digits — it is what
 * gets written to `call_attempts.dialed_number`, and that column's meaning must
 * not change. But the native plugin was being handed those bare digits while
 * the web fallback used `href` (`tel:+91…`), so the two paths dialled different
 * strings. Domestically both work; for a stored international number the bare
 * form is simply wrong. Derive from `href` so there is one dial string.
 */
export function dialString(target: DialTarget): string {
  return target.href.replace(/^tel:/i, '')
}

/**
 * Place the call. Never throws — a dial that cannot happen must surface as a
 * visible failure in the UI, not an unhandled rejection.
 *
 * Returns whether the native path was used, so the caller can decide whether
 * to expect 'callStarted'/'callEnded' events.
 */
export async function placeCall(target: DialTarget): Promise<{ native: boolean }> {
  if (isNativePlatform()) {
    try {
      const { Call } = await import('@/lib/call/plugin')
      await Call.dial({ phoneNumber: dialString(target) })
      // Fire-and-forget: call-state tracking is a nice-to-have and must never
      // block or fail the dial itself.
      void Call.startListening().catch(() => undefined)
      return { native: true }
    } catch {
      // Plugin missing, permission path failed, or no dialer resolved —
      // fall through to the system handoff so the call still happens.
    }
  }

  await openExternalUrl(target.href)
  return { native: false }
}

export { dialTarget }
