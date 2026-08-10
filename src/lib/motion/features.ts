/**
 * The Motion feature bundle, isolated in its own module so it can be
 * code-split out of the initial route.
 *
 * `LazyMotion` accepts either the bundle itself (synchronous, in the main
 * chunk) or a function returning a promise of it (a separate chunk, fetched
 * after first paint). We use the second form — see MotionProvider — which is
 * why this file exists at all and why the export is DEFAULT: Motion's loader
 * reads `res.default`.
 *
 * `domAnimation` and not `domMax`, deliberately. `domMax` adds layout
 * projection and drag. Layout projection measures the DOM every frame, and
 * the two longest screens in this app are the 238-row calling queue and the
 * guest list. Importing the bundle that makes `layout` available is how it
 * ends up used on those screens six months from now. Leaving it out means
 * the expensive path is not merely discouraged, it is absent.
 */
import { domAnimation } from 'motion/react'

export default domAnimation
