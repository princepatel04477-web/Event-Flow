'use client'

import { AnimatePresence } from 'motion/react'
import * as m from 'motion/react-m'
import { useCallback, useEffect, useState } from 'react'

import { claimWelcome } from '@/lib/motion/cold-start'
import { isNativePlatform } from '@/lib/native/platform'
import {
  DURATION,
  EASE,
  WELCOME_CEILING_MS,
  WELCOME_MIN_MS,
  riseVariants,
} from '@/lib/motion/tokens'

/**
 * The cold-start welcome, and the thing that hides the native splash.
 *
 * ── It always mounts, even when it shows nothing ───────────────────────────
 * Hiding the native splash is this component's OTHER job, and it is the one
 * that must never be skipped. If the splash hide were conditional on the
 * welcome playing, then any path where the welcome is suppressed — a return
 * from the dialer, blocked sessionStorage — would leave the handset parked on
 * the splash with a working app behind it. So: mount unconditionally, hide the
 * splash unconditionally, and treat the animation as the optional part.
 *
 * ── Sequence ───────────────────────────────────────────────────────────────
 *   native splash  →  overlay paints (same ground, so no seam)
 *                  →  splash hidden  →  wordmark rises  →  overlay fades out
 *
 * The splash is hidden only AFTER the overlay has painted a frame. Hiding it
 * on mount instead would expose the login screen for a frame or two before the
 * overlay covered it — a flash of the destination, which reads as a bug.
 *
 * ── Why it cannot outstay its welcome ──────────────────────────────────────
 * Two independent dismissals, whichever comes first:
 *   - ready:   one animation frame after mount, i.e. the app is interactive
 *   - ceiling: a hard WELCOME_CEILING_MS timer
 * The ceiling is not decoration. If hydration stalls on bad venue Wi-Fi, the
 * `ready` path may be late; the timer guarantees a caller is never held behind
 * a brand animation. It is also tappable, so an impatient thumb always wins.
 *
 * Transform and opacity only — no width/height/top/left/filter anywhere.
 */
export function WelcomeOverlay() {
  // Claimed once, in a lazy initialiser, so a remount cannot re-claim.
  const [playing, setPlaying] = useState<boolean>(() => claimWelcome())
  const [painted, setPainted] = useState(false)
  const [mountedAt] = useState(() => Date.now())

  const dismiss = useCallback(() => setPlaying(false), [])

  /**
   * Hide the native splash once the overlay has actually painted.
   *
   * Two rAFs: the first fires before the browser paints the frame React just
   * committed, the second after it. Hiding on the first would still race the
   * paint on a slow handset — precisely the device this app targets.
   */
  useEffect(() => {
    let cancelled = false
    let inner = 0

    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        if (cancelled) return
        setPainted(true)

        if (!isNativePlatform()) return
        void import('@capacitor/splash-screen')
          .then(({ SplashScreen }) => SplashScreen.hide())
          .catch(() => {
            // The native backstop (launchAutoHide in capacitor.config.ts)
            // clears the splash regardless, so a failure here costs a slower
            // first screen, never a stuck one.
          })
      })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [])

  /**
   * Dismiss as soon as the app is interactive — but not so fast it flashes.
   * A hydrate that finishes in 40ms would otherwise show the wordmark for
   * less than three frames, which looks like a glitch rather than a greeting.
   */
  useEffect(() => {
    if (!playing || !painted) return

    const elapsed = Date.now() - mountedAt
    const ready = window.setTimeout(dismiss, Math.max(0, WELCOME_MIN_MS - elapsed))
    const ceiling = window.setTimeout(dismiss, Math.max(0, WELCOME_CEILING_MS - elapsed))

    return () => {
      window.clearTimeout(ready)
      window.clearTimeout(ceiling)
    }
  }, [playing, painted, mountedAt, dismiss])

  return (
    <AnimatePresence>
      {playing && (
        <m.div
          // `fixed inset-0` rather than an animated width/height. The element
          // never changes box; only its opacity does.
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: DURATION.fade, ease: EASE.ledger } }}
          onClick={dismiss}
          // Not a dialog and not a control: it is a transient curtain that any
          // tap clears. Announcing it would interrupt a screen reader on its
          // way to the login form for no information gain.
          aria-hidden="true"
        >
          <m.div
            className="flex flex-col items-center gap-2"
            variants={riseVariants}
            initial="hidden"
            animate="visible"
          >
            <span className="font-display text-4xl leading-none text-ink">Nuvent</span>
            <span className="font-sans text-xs tracking-eyebrow text-muted uppercase">
              Varunya Technologies
            </span>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  )
}

export default WelcomeOverlay
