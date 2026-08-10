/**
 * The only place a duration, easing curve or travel distance is written for
 * JS-driven motion. No component may hardcode a number — import from here.
 *
 * ── Source of truth ────────────────────────────────────────────────────────
 * `src/app/globals.css` already defines this vocabulary as CSS custom
 * properties (`--ef-ease`, `--ef-duration-press|fade|enter`), and CSS-driven
 * motion — every per-row press state, every hover — reads it from there.
 * This file MIRRORS those values for Motion, which needs seconds (not `ms`)
 * and a four-number array (not a `cubic-bezier()` string).
 *
 * The two must not drift. Changing a value means changing it in BOTH files.
 * The pairing is asserted in `tests/motion-tokens.test.ts`, which parses the
 * real globals.css — so drift fails the test run rather than shipping as an
 * animation subtly off from every CSS transition beside it.
 *
 * ── Budget ─────────────────────────────────────────────────────────────────
 * Set deliberately below the brief's ceilings; the existing design system was
 * already tighter than the brief asked for, so we kept its numbers:
 *
 *   feedback  100ms  (brief allows 150) — press states
 *   fade      150ms  (brief allows 150) — opacity in/out
 *   enter     280ms  (brief allows 250 on a PRIMARY ACTION PATH, 400 ceiling)
 *
 * `enter` at 280ms is the one value above the brief's 250ms transition figure.
 * It is deliberate and in-bounds: 280ms is an ENTRY sequence (a screen
 * arriving), never a primary action path, and it sits under the 400ms absolute
 * ceiling. Nothing a caller taps to dial, confirm, or submit uses it — those
 * use `feedback` or `fade`. Do not reuse `enter` on an action path.
 */

/** Milliseconds. Matches the `--ef-duration-*` custom properties exactly. */
export const DURATION_MS = {
  /** Press / release state feedback. Primary action paths. */
  feedback: 100,
  /** Opacity in-out. Primary action paths, confirmations. */
  fade: 150,
  /** Screen and overlay entry sequences. NEVER a primary action path. */
  enter: 280,
} as const

/** Seconds. Motion's `transition.duration` is in seconds, not milliseconds. */
export const DURATION = {
  feedback: DURATION_MS.feedback / 1000,
  fade: DURATION_MS.fade / 1000,
  enter: DURATION_MS.enter / 1000,
} as const

/**
 * Easing, as the four control points of the matching `cubic-bezier()`.
 *
 * `ledger` is the house curve — a strong ease-out that arrives quickly and
 * settles, which reads as responsive on a cheap handset where a symmetric
 * ease reads as sluggish. `seal` is the symmetric one, reserved for the
 * confirmation stamp.
 */
export const EASE = {
  /** cubic-bezier(0.23, 1, 0.32, 1) — `--ef-ease` */
  ledger: [0.23, 1, 0.32, 1],
  /** cubic-bezier(0.65, 0, 0.35, 1) — `--ef-ease-seal` */
  seal: [0.65, 0, 0.35, 1],
} as const satisfies Record<string, [number, number, number, number]>

/**
 * The ONE spring. Do not invent a second one per component.
 *
 * Tuned to settle in roughly `enter` (~280ms) without overshoot you can read
 * as a wobble — a bouncing panel on an operations tool looks like a bug, not
 * a flourish. `visualDuration` expresses "how long until it looks arrived",
 * which is what we actually budget against; `bounce: 0` keeps it critically
 * damped.
 */
export const SPRING = {
  type: 'spring',
  visualDuration: DURATION.enter,
  bounce: 0,
} as const

/**
 * Travel distances, px. Small on purpose: this is a 360px-wide handset held
 * at arm's length, and a 24px slide that looks refined on a desktop mock
 * reads as a lurch on a phone.
 */
export const DISTANCE = {
  /** A wordmark or heading settling into place. */
  rise: 8,
  /** A sheet or overlay leaving downward. */
  sink: 12,
} as const

/**
 * Shared variants. Transform and opacity ONLY — never width, height, top,
 * left, margin, box-shadow, filter or backdrop-filter. Those four all trigger
 * layout or paint on the compositor's critical path and drop frames on the
 * hardware this app targets.
 */
export const fadeVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.fade, ease: EASE.ledger } },
  exit: { opacity: 0, transition: { duration: DURATION.fade, ease: EASE.ledger } },
} as const

export const riseVariants = {
  hidden: { opacity: 0, y: DISTANCE.rise },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: DURATION.enter, ease: EASE.ledger },
  },
  exit: {
    opacity: 0,
    transition: { duration: DURATION.fade, ease: EASE.ledger },
  },
} as const

/**
 * Cold-start welcome budget, ms. The hard ceiling is a product constraint,
 * not a taste one: staff open this app dozens of times a shift, so every ms
 * here is paid dozens of times per person per day.
 *
 * `WELCOME_CEILING_MS` is enforced by a timer in WelcomeOverlay, so a stalled
 * hydration can never strand a caller behind a splash. It is the maximum the
 * overlay may live for, INCLUDING its exit fade.
 */
export const WELCOME_CEILING_MS = 1200

/** Minimum on-screen time, so a fast hydrate does not produce a visible flash. */
export const WELCOME_MIN_MS = 320
