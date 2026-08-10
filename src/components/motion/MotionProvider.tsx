'use client'

import { LazyMotion, MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'

import { EASE, DURATION } from '@/lib/motion/tokens'

/**
 * Motion, configured for a WebView on a cheap Android handset on bad venue
 * Wi-Fi — not for a desktop site.
 *
 * Three decisions, each load-bearing:
 *
 * 1. `features` is a FUNCTION, not the bundle itself. Passing `domAnimation`
 *    directly would put the whole feature set in the initial chunk. Passing a
 *    loader defers it to a separate chunk fetched after first paint, so the
 *    login screen — the only screen a cold start actually renders — does not
 *    pay for it. This is the difference between a ~4.6KB and a ~34KB floor.
 *
 * 2. `strict`. Rendering a full `motion.*` component anywhere inside throws.
 *    That is the point: the `m` + LazyMotion split only saves anything if
 *    nobody imports the full component, and a runtime error in dev is a far
 *    cheaper teacher than a bundle that quietly regrew. Do not remove it to
 *    silence an error — fix the import to `motion/react-m` instead.
 *
 * 3. `reducedMotion="user"` follows the OS setting rather than guessing.
 *    Under it, Motion holds transform animations at their final value and
 *    keeps opacity ones, so the app is still and fully usable rather than
 *    still and half-invisible. globals.css already collapses CSS transitions
 *    under the same media query, so both halves of the app agree.
 *
 * Mounted once, in the root layout. It renders no DOM of its own.
 */

/** Separate chunk; see lib/motion/features.ts for why this is not inline. */
const loadFeatures = () => import('@/lib/motion/features').then((mod) => mod.default)

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={loadFeatures} strict>
      <MotionConfig
        reducedMotion="user"
        transition={{ duration: DURATION.fade, ease: EASE.ledger }}
      >
        {children}
      </MotionConfig>
    </LazyMotion>
  )
}

export default MotionProvider
