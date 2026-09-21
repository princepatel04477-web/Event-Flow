'use client'

import { useCallback, useEffect, useRef } from 'react'

import { hintKey, useDeviceFlag, useSetDeviceFlag } from './device-flags'

/**
 * The one-line first-visit hint.
 *
 * ── One per screen, and only one ──────────────────────────────────────────
 * Each screen passes its OWN id and its OWN line. Nothing here reads a list of
 * hints, so there is no way for two to render on one screen by accident and no
 * queue to get out of step — the constraint is structural rather than a rule
 * someone has to remember.
 *
 * ── Why it goes away and stays away ───────────────────────────────────────
 * Dismissal is a per-device flag (see `device-flags.ts`), so it is shown once
 * and never again on that handset — not once per launch, and not once per
 * navigation. That distinction matters: the cold-start splash marker
 * (`nuvent.welcome.played`) is per LAUNCH, and reusing it here would put this
 * line back on the screen every time a caller returned from the dialer.
 *
 * ── What it is NOT ────────────────────────────────────────────────────────
 * It is not a tour step, not a coach mark and not a gate. The screen beneath it
 * is fully interactive the whole time; a tap anywhere on the hint clears it and
 * the tap is not swallowed — the hint is a `<button>`, so the same tap cannot
 * also press something underneath it by accident.
 */
export interface AppHintProps {
  /** Stable id for this screen. Becomes the storage key, so keep it stable. */
  screen: string
  /** ONE line. If it needs a comma, it is two lines and the second is cut. */
  children: string
}

export function AppHint({ screen, children }: AppHintProps) {
  const key = hintKey(screen)
  const seen = useDeviceFlag(key)
  const setFlag = useSetDeviceFlag()

  const dismiss = useCallback(() => setFlag(key, '1'), [key, setFlag])

  /**
   * Has the gesture that put this hint on screen finished yet?
   *
   * `useRef` and not state, deliberately: it is read inside a DOM listener,
   * where a state value would be the one captured when the listener attached.
   */
  const armedRef = useRef(false)

  /**
   * "Dismiss on any tap" — any tap anywhere, not just a tap on the hint.
   *
   * A pointerup listener on the document rather than a wrapper around the
   * screen: wrapping a page in a click handler would put a listener between the
   * runner and every control on it, and a CAPTURE-phase pointerup clears the
   * line on the first tap wherever it landed.
   *
   * ── The gesture that MOUNTS the hint must not also dismiss it ─────────────
   * This is the whole difficulty, and it cost a live first-run walk to find.
   * The first-run cards are dismissed by a tap; the hint mounts in the commit
   * that tap causes, while that same tap is still being dispatched. A listener
   * attached during that commit therefore sees the tail of the tapping gesture
   * and dismissed the hint before any human saw it. The source looked perfect
   * and the hint was invisible on every fresh device.
   *
   * So the FIRST pointerup this listener ever sees is consumed as "the gesture
   * that got us here", and from then on any pointerup clears the line. That is
   * exact rather than a heuristic, and there is nothing to lose: a pointerup
   * cannot arrive without a pointerdown before it, and this listener did not
   * exist when that pointerdown was dispatched — a deliberate tap ON this hint
   * (or on the screen around it) always has both of its own events ahead of it.
   *
   * A time-based arming delay was tried first and rejected: it makes the hint
   * survive a genuinely fast tap, which is a real behaviour on a cheap handset,
   * and "my first tap did nothing" is worse than no hint at all.
   */
  useEffect(() => {
    const onPointerUp = () => {
      if (!armedRef.current) {
        armedRef.current = true
        return
      }
      dismiss()
    }
    document.addEventListener('pointerup', onPointerUp, { capture: true })
    return () => document.removeEventListener('pointerup', onPointerUp, { capture: true })
  }, [dismiss])

  // `undefined` is "this device has not answered yet" — render nothing rather
  // than flash the hint at someone who dismissed it weeks ago. `null` is
  // "settled and not seen", which is the only state that draws the line.
  if (seen !== null) return null

  return (
    <button
      type="button"
      onClick={dismiss}
      className="tap flex min-h-11 w-full items-center gap-2 rounded-xl border border-brand/25 bg-brand-tint px-3 py-2 text-left text-sm leading-snug text-ink active:bg-surface-2"
      data-hint={screen}
    >
      <span aria-hidden className="shrink-0 font-mono text-xs text-brand">
        ?
      </span>
      <span className="min-w-0 flex-1">{children}</span>
      <span className="shrink-0 text-xs text-muted">Got it</span>
    </button>
  )
}

export default AppHint
