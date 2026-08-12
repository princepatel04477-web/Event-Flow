'use client'

import * as m from 'motion/react-m'
import { useCallback, useEffect, useState } from 'react'

import { claimWelcome } from '@/lib/motion/cold-start'
import { isNativePlatform } from '@/lib/native/platform'
import {
  DURATION,
  DURATION_MS,
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
 *   - ready:   WELCOME_MIN_MS after the claim, i.e. the app is interactive
 *   - ceiling: a hard WELCOME_CEILING_MS timer
 * The ceiling is not decoration. If hydration stalls on bad venue Wi-Fi, the
 * `ready` path may be late; the timer guarantees a caller is never held behind
 * a brand animation. It is also tappable, so an impatient thumb always wins.
 *
 * ── Why there is no AnimatePresence ────────────────────────────────────────
 * This used one, and it was the wrong tool for THIS element. AnimatePresence
 * unmounts a child when its exit animation reports completion, and Motion
 * drives that animation on rAF — which a backgrounded WebView does not run.
 * The failure mode is not a missed flourish: it is an opaque, click-blocking
 * full-screen curtain left over the login form, and it was measured (4s
 * against a 1.2s budget, `pointerEvents: auto`, `opacity: 1`).
 *
 * So the unmount is driven by a timer instead. The fade is still Motion's,
 * but nothing about whether the overlay GOES depends on the animation
 * finishing — the worst case is that it disappears without fading, which is
 * exactly the right thing to degrade to.
 *
 * Transform and opacity only — no width/height/top/left/filter anywhere.
 */
export function WelcomeOverlay() {
  /**
   * `idle` until the client says otherwise — and the claim happens in an
   * effect, never in a render or a lazy `useState` initialiser.
   *
   * This is not stylistic. `claimWelcome()` reads sessionStorage, which does
   * not exist on the server, so it returns false there and true on the client.
   * Claiming during render therefore makes the server send an empty tree and
   * the client hydrate a full-screen overlay — a hydration mismatch (React
   * #418), which React resolves by throwing away the server HTML and
   * re-rendering the whole subtree on the client. Doing the claim in an
   * effect means both sides render `idle` first and agree.
   */
  const [phase, setPhase] = useState<'idle' | 'playing' | 'leaving' | 'done'>('idle')
  const [painted, setPainted] = useState(false)
  const [startedAt, setStartedAt] = useState(0)

  /** Starts the fade. The unmount is a separate, timer-driven step. */
  const dismiss = useCallback(
    () => setPhase((p) => (p === 'playing' ? 'leaving' : p)),
    [],
  )

  /**
   * Effects run only on the client, and only after hydration has matched.
   *
   * `setTimeout` and NOT `requestAnimationFrame`, which is the whole point.
   * rAF does not fire at all while a page is backgrounded, and this app
   * backgrounds itself as a matter of routine: firing a `tel:` hands the
   * screen to the dialer (CLAUDE.md §12). An rAF here made the welcome's
   * appearance — and, worse, its dismissal — contingent on the WebView being
   * foregrounded, which measured as a 4-SECOND overlay in a throttled page
   * against a 1.2s ceiling. `setTimeout` is throttled in the background but
   * never frozen, so the sequence always completes.
   *
   * The 0ms delay still puts the state change a macrotask clear of
   * hydration, which is all the hydration fix required.
   */
  useEffect(() => {
    const id = window.setTimeout(() => {
      const play = claimWelcome()
      setStartedAt(Date.now())
      setPhase(play ? 'playing' : 'done')
    }, 0)

    return () => window.clearTimeout(id)
  }, [])

  /**
   * Hide the native splash once the overlay has actually painted.
   *
   * Two rAFs: the first fires before the browser paints the frame React just
   * committed, the second after it. Hiding on the first would still race the
   * paint on a slow handset — precisely the device this app targets.
   *
   * The rAF pair is an OPTIMISATION and is allowed to never fire (a
   * backgrounded WebView freezes it). A `setTimeout` runs the same work if it
   * does not, so the splash is never left up waiting for a frame that is not
   * coming. Both paths funnel through `reveal`, which is idempotent.
   */
  useEffect(() => {
    // Wait until the claim has resolved. Hiding the splash while still `idle`
    // would uncover the login screen a frame before the overlay exists.
    if (phase === 'idle' || painted) return

    let done = false
    let inner = 0

    const reveal = () => {
      if (done) return
      done = true
      setPainted(true)

      if (!isNativePlatform()) return
      void import('@capacitor/splash-screen')
        .then(({ SplashScreen }) => SplashScreen.hide())
        .catch(() => {
          // The native backstop (launchAutoHide in capacitor.config.ts)
          // clears the splash regardless, so a failure here costs a slower
          // first screen, never a stuck one.
        })
    }

    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(reveal)
    })
    // Two frames at 60fps is ~32ms; anything past this means rAF is throttled.
    const fallback = window.setTimeout(reveal, 100)

    return () => {
      done = true
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
      window.clearTimeout(fallback)
    }
  }, [phase, painted])

  /**
   * Dismiss as soon as the app is interactive — but not so fast it flashes.
   * A hydrate that finishes in 40ms would otherwise show the wordmark for
   * less than three frames, which looks like a glitch rather than a greeting.
   *
   * Deliberately NOT gated on `painted`. It was, and that made the ceiling
   * conditional on a frame callback that a backgrounded WebView never
   * delivers — the overlay then outlived its 1.2s budget by whole seconds.
   * The guarantee has to rest on timers alone: `painted` may never arrive,
   * and the caller still gets their screen back.
   *
   * Both timers are armed from `startedAt` rather than from now, so a late
   * re-run cannot extend the budget.
   */
  useEffect(() => {
    if (phase !== 'playing') return

    const elapsed = Date.now() - startedAt
    const ready = window.setTimeout(dismiss, Math.max(0, WELCOME_MIN_MS - elapsed))
    // The ceiling is the budget for the WHOLE overlay, fade included, so the
    // fade has to start one fade-length before it — otherwise a dismissal at
    // exactly the ceiling would put the last painted frame past it.
    const ceiling = window.setTimeout(
      dismiss,
      Math.max(0, WELCOME_CEILING_MS - DURATION_MS.fade - elapsed),
    )

    return () => {
      window.clearTimeout(ready)
      window.clearTimeout(ceiling)
    }
  }, [phase, startedAt, dismiss])

  /**
   * The unmount. A plain timer, not an animation callback — see the note at
   * the top about why the curtain must never depend on rAF to come down.
   */
  useEffect(() => {
    if (phase !== 'leaving') return
    const id = window.setTimeout(() => setPhase('done'), DURATION_MS.fade)
    return () => window.clearTimeout(id)
  }, [phase])

  if (phase === 'idle' || phase === 'done') return null

  const leaving = phase === 'leaving'

  return (
    <m.div
      // `fixed inset-0` rather than an animated width/height. The element
      // never changes box; only its opacity does.
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-paper"
      initial={{ opacity: 1 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      transition={{ duration: DURATION.fade, ease: EASE.ledger }}
      // Stop swallowing taps the moment it starts leaving. If the fade is
      // frozen (backgrounded WebView) the node lingers for one fade length
      // before the unmount timer fires; during that window it must not eat
      // the tap that lands on the login field underneath it.
      style={{ pointerEvents: leaving ? 'none' : 'auto' }}
      onClick={dismiss}
      // Not a dialog and not a control: it is a transient curtain that any
      // tap clears. Announcing it would interrupt a screen reader on its way
      // to the login form for no information gain.
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
  )
}

export default WelcomeOverlay
