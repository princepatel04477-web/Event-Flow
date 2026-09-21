'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { LinkButton } from '@/components/ui/LinkButton'
import { WELCOME_CEILING_MS } from '@/lib/motion/tokens'

import { FIRST_RUN_KEY, useDeviceFlag, useSetDeviceFlag } from './device-flags'

/**
 * The three cards a device sees once, the first time it opens the new UI.
 *
 * ── One overlay, not a second one ─────────────────────────────────────────
 * `src/components/motion/WelcomeOverlay.tsx` is the cold-start curtain: it
 * paints over the native splash, fades, and unmounts — and it does that on
 * EVERY app launch, because its marker (`nuvent.welcome.played`) means "this
 * launch", not "this device, ever" (see `src/lib/motion/cold-start.ts`). It is
 * also mounted from the ROOT layout, above the point where the route is known,
 * and it is shared with the live v1 app.
 *
 * So it is not a host for first-run content: this module renders into the same
 * shell for the same visual result, starting only after the welcome's ceiling
 * has passed, so the two never stack and the sequence reads as one screen
 * handing off to the next. Nothing in `WelcomeOverlay.tsx` was changed — v1's
 * rendered behaviour is untouched, byte for byte, because the file was not
 * opened.
 *
 * ── Why nothing renders until the flag has been read ──────────────────────
 * `useDeviceFlag` answers `undefined` until the device has been consulted (see
 * `device-flags.ts`). A returning staff member must see the app, not this —
 * and the server cannot know, so "not yet" renders NOTHING on both sides rather
 * than guessing and correcting a frame later.
 *
 * ── Why it cannot hold anyone up ─────────────────────────────────────────
 * Three independent exits, and none of them needs a tap: Skip is on the first
 * card, Done is on the last, and the flag is written the moment either fires.
 * A swipe is a real swipe — the cards are a horizontally scroll-snapping track,
 * not a JS gesture handler — and there is no dim, no spotlight and no step that
 * gates a control behind it. The whole thing is skippable from the first frame.
 */

interface Card {
  title: string
  line: string
}

/**
 * THREE lines, and the third one is the training line from CLAUDE.md §11b —
 * the only sentence in this app that is worth interrupting a first-run for. No
 * card carries a second sentence: five words over the point is already too
 * many, and this is the screen where the temptation to explain is strongest.
 */
const CARDS: Card[] = [
  {
    title: 'Your next job is on the home screen',
    line: 'Open it and tap the card at the top.',
  },
  {
    title: 'Find anyone in two taps',
    line: 'The magnifier in the header finds a name or a room.',
  },
  {
    title: 'Everything you tap is saved, even with no signal',
    line: 'If it stops responding, wait — do not reload.',
  },
]

export interface FirstRunCardsProps {
  /** Where the runner came from, so Skip and Done put them back there. */
  doneHref: string
}

export function FirstRunCards({ doneHref }: FirstRunCardsProps) {
  const stored = useDeviceFlag(FIRST_RUN_KEY)
  const setFlag = useSetDeviceFlag()

  /** Held back until the cold-start welcome has finished with the screen. */
  const [welcomeDone, setWelcomeDone] = useState(false)
  const [index, setIndex] = useState(0)
  const trackRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    // WELCOME_CEILING_MS is the welcome's hard maximum, fade included, enforced
    // by its own timers (`src/lib/motion/tokens.ts`). Waiting exactly that long
    // means this can never paint underneath the curtain, on any device,
    // including one where hydration is slow and the ceiling is what ended the
    // welcome. It is one timer, started once, and it must never be a condition
    // on an animation frame — a backgrounded WebView does not run those.
    const id = window.setTimeout(() => setWelcomeDone(true), WELCOME_CEILING_MS)
    return () => window.clearTimeout(id)
  }, [])

  const dismiss = useCallback(() => {
    // The write is optimistic and not awaited — see device-flags.ts.
    setFlag(FIRST_RUN_KEY, '1')
  }, [setFlag])

  /** Which card is showing, from the track's own scroll position. */
  const onScroll = useCallback(() => {
    const track = trackRef.current
    if (!track || track.clientWidth === 0) return
    setIndex(Math.round(track.scrollLeft / track.clientWidth))
  }, [])

  const advance = useCallback(() => {
    const track = trackRef.current
    if (!track) {
      dismiss()
      return
    }
    const next = Math.min(index + 1, CARDS.length - 1)
    if (next === index) {
      dismiss()
      return
    }
    // `behavior: 'smooth'` is a scroll, not a layout animation — T6 bans
    // animating layout on the touch path, and this is one card's width in a
    // snapping track, which the compositor already owns.
    track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' })
    setIndex(next)
  }, [dismiss, index])

  /**
   * Reaching the last card IS seeing the cards. Marking it here rather than on
   * a tap means a runner who swipes to card three and then force-closes the app
   * (CLAUDE.md §11c: force-close discards sessionStorage) does not get the run
   * again next launch. The write is idempotent and the effect only fires while
   * the flag is still unset — which is the state this component renders in.
   */
  const last = index >= CARDS.length - 1
  useEffect(() => {
    if (last) dismiss()
  }, [last, dismiss])

  // "Not yet" and "already seen" are different answers and both render nothing.
  if (stored === undefined || stored !== null) return null
  if (!welcomeDone) return null

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-paper"
      // A named region rather than a dialog: nothing is gated behind it, every
      // control inside works, and the app underneath is fully rendered. The
      // role exists so a screen reader announces what appeared, once.
      role="region"
      aria-label="Before you start"
      data-first-run="cards"
    >
      <div className="flex justify-end px-3 pb-1 pt-safe">
        <button
          type="button"
          onClick={dismiss}
          className="tap inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-medium text-muted underline-offset-4 active:bg-surface-2"
        >
          Skip
        </button>
      </div>

      {/*
        A snapping scroll track, so the swipe is the browser's own — no gesture
        library, no drag handler, and it keeps working when a JS frame is
        dropped on a cheap handset. `snap-always` means a half-swipe settles on
        a card rather than resting between two.
      */}
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden"
        aria-live="polite"
      >
        {CARDS.map((card) => (
          <section
            key={card.title}
            className="flex w-full shrink-0 snap-center snap-always flex-col justify-center gap-3 px-6 pb-6"
          >
            <h1 className="text-2xl leading-snug font-semibold text-balance text-ink">
              {card.title}
            </h1>
            <p className="text-base leading-relaxed text-pretty text-muted">{card.line}</p>
          </section>
        ))}
      </div>

      <div className="flex flex-col gap-3 px-6 pb-safe">
        <div className="flex justify-center gap-2" aria-hidden>
          {CARDS.map((card, i) => (
            <span
              key={card.title}
              className={
                i === index
                  ? 'h-1.5 w-6 rounded-full bg-brand transition-colors duration-press ease-ledger'
                  : 'h-1.5 w-1.5 rounded-full bg-rule-strong transition-colors duration-press ease-ledger'
              }
            />
          ))}
        </div>

        {/*
          `LinkButton` and not a `<button onClick={router.push}>`: a navigation
          target has to stay a link (prefetch, long-press, announced as a link).
          The flag is written by the effect above, from `onScroll`, so reaching
          the last card marks the run seen before the tap — which also means a
          runner who swipes to card three and then force-closes the app does not
          get the cards again.
        */}
        {last ? (
          <LinkButton href={doneHref} size="lg" fullWidth>
            Start working
          </LinkButton>
        ) : (
          <Button size="lg" fullWidth onClick={advance}>
            Next
          </Button>
        )}
      </div>
    </div>
  )
}

export default FirstRunCards
