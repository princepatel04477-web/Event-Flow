import { DISTANCE } from './tokens'

/**
 * The arithmetic behind pull-to-refresh (M5), as pure functions so
 * `tests/pull-to-refresh.test.ts` can pin it without a touch screen.
 *
 * DAMPING. The content tracks the finger 1:1 at first and then ever more
 * reluctantly, so a long drag never drags the screen off the phone and the
 * pull reads as "elastic", not "broken". It approaches `DISTANCE.pullMax` and
 * never passes it. The trigger is reached after ~105px of finger travel.
 */
export function pullDistance(fingerDy: number): number {
  if (fingerDy <= 0) return 0
  const max = DISTANCE.pullMax
  // max * (1 - e^(-x/max)) has slope 1 at zero and flattens towards `max`.
  return max * (1 - Math.exp(-fingerDy / max))
}

/** Whether a released pull of this (damped) distance should refresh. */
export function shouldRefresh(pulled: number): boolean {
  return pulled >= DISTANCE.pullTrigger
}

/** 0..1 progress towards the trigger, for the indicator's opacity and turn. */
export function pullProgress(pulled: number): number {
  if (pulled <= 0) return 0
  return Math.min(1, pulled / DISTANCE.pullTrigger)
}

/**
 * Whether a touch that starts on this element may begin a pull.
 *
 * A pull must never steal a gesture that belongs to something else: text
 * fields (a drag selects text), anything inside a bottom sheet or dialog (the
 * sheet has its own drag-to-close), and anything that opts out with
 * `data-no-pull`.
 */
export function pullAllowedFrom(target: Element | null): boolean {
  if (!target) return true
  return target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [data-no-pull]') === null
}
