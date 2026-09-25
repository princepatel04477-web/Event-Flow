import { describe, expect, it } from 'vitest'

import { v3TabsFor } from '@/lib/sections/v3'

/**
 * Width arithmetic for the v3 Travel and Hampers controls at 360px.
 *
 * WHY A FILE OF ARITHMETIC AND NOT A SCREENSHOT. The named gates for this job
 * include screenshots at 360px and 390px, and this session's sandbox refused to
 * launch Chromium (`spawn EPERM` on the browser binary, and the escalation
 * request had no approval channel) — so "look at the screen" was not available.
 * What IS available is the same technique `tests/phone-layout.test.ts` uses for
 * the calls filter row: measure the label strings against the width the layout
 * actually hands them, with a conservative per-character constant, and fail
 * loudly if one cannot fit.
 *
 * WHY IT MATTERS ON THESE TWO SCREENS SPECIFICALLY. `BottomBar` is `fixed`, so
 * it cannot scroll horizontally: a label wider than its half of the bar is not
 * a clipped screenshot, it is a control whose right-hand characters a runner
 * cannot read and cannot reach. The hamper run and the travel board are the two
 * screens that put a label in it.
 *
 * WHAT THIS DOES NOT PROVE, stated so it is not mistaken for more: it is a
 * character-count estimate, not a measurement. It cannot see a two-line wrap
 * that a real browser would produce, and it says nothing about vertical
 * crowding. Its only claim is "these labels fit the box on the worst phone this
 * app supports".
 */

/** The v2 content column: `max-w-[480px] px-4`. */
const CONTENT = (viewport: number) => viewport - 32

/** `BottomBar`'s own padding (`px-4`) and the `gap-2.5` between its halves. */
const BAR_GUTTER = 32 + 10

/** A `lg` Button's horizontal padding: `px-5`. */
const BUTTON_PADDING = 40

/** A 20px leading glyph plus its `gap-2`. */
const ICON = 20 + 8

/**
 * Conservative per-character width for the UI sans at `text-sm font-medium`
 * (14px). Same constant as `phone-layout.test.ts`, so the two suites cannot
 * disagree about what "conservative" means. Digits and lowercase are narrower
 * than this; the `·` separator and spaces are much narrower.
 */
const CHAR_PX = 8.5

const labelWidth = (label: string, withIcon = false) =>
  label.length * CHAR_PX + (withIcon ? ICON : 0)

/** The inner width of one of `BottomBar`'s two equal controls. */
const barControlWidth = (viewport: number) =>
  (CONTENT(viewport) - BAR_GUTTER) / 2 - BUTTON_PADDING

describe('the hamper run BottomBar', () => {
  const LABELS: [string, boolean][] = [
    // The secondary, and the primary with its camera glyph.
    ['Not in room', false],
    ['Photo', true],
  ]

  it('fits both controls at 360px, which is the narrowest supported phone', () => {
    const room = barControlWidth(360)
    for (const [label, withIcon] of LABELS) {
      expect(
        labelWidth(label, withIcon),
        `"${label}" needs ${labelWidth(label, withIcon)}px of ${room}px inside its half of the bar`,
      ).toBeLessThanOrEqual(room)
    }
  })

  it('fits at 390px too, with margin', () => {
    const room = barControlWidth(390)
    for (const [label, withIcon] of LABELS) {
      expect(labelWidth(label, withIcon)).toBeLessThanOrEqual(room)
    }
  })

  it('would NOT have fitted "Photo · delivered" or "Take photo" with the glyph', () => {
    // The reasons the label reads "Photo". Pinned rather than left as prose in
    // the component, because the next session's instinct will be to restore the
    // longer, more reassuring wording — and both of these overflow a fixed bar
    // that cannot scroll.
    expect(labelWidth('Photo · delivered', true)).toBeGreaterThan(barControlWidth(360))
    expect(labelWidth('Take photo', true)).toBeGreaterThan(barControlWidth(360))
  })
})

describe('the travel Segmented', () => {
  it('fits Arrivals and Departures side by side at 360px', () => {
    // `Segmented`: `p-1` on the track and `gap-1` between the two halves, then
    // `px-3` inside each segment.
    const room = (CONTENT(360) - 8 - 4) / 2 - 24
    for (const label of ['Arrivals', 'Departures']) {
      expect(labelWidth(label)).toBeLessThanOrEqual(room)
    }
  })
})

describe('the v3 tab labels a Travel or Hampers runner gets', () => {
  /**
   * FINDING, NOT A PASS. At 360px the v3 bar gives each of five tabs
   * `(328 − 5) / 5 ≈ 65px`, and the tab label is `text-xs` (12px) under
   * `max-w-full truncate`. Measured at a conservative 7px/char:
   *
   *   Departures       70px
   *   Check in / out   98px
   *   Arrivals         56px
   *   Hampers          56px
   *   Hospitality      77px
     *   Logistics        63px
   *
   * So three labels render as an ellipsis at 360px. Two predate the T3 rename
   * and one came with it. None are fixed here, and they must not be quietly asserted
   * as fine: they come from `SECTIONS` in `src/lib/sections/config.tsx`, which
   * v1's bottom bar shares, and renaming them moves v1's tabs too. The screen
   * title in the header stays legible regardless — `v3ScreenTitle` returns the
   * child's full label — so these are bar-label issues, not lost screens.
   * Recorded in `.brain/report-travel.md` for whoever owns `config.tsx`.
   */
  it('documents the labels that do not fit, rather than pretending they do', () => {
    const perTab = (CONTENT(360) - 5) / 5
    const labels = [
      ...v3TabsFor('SHARMA26', 'admin', 'management'),
      ...v3TabsFor('SHARMA26', 'event_team', 'logistics'),
      ...v3TabsFor('SHARMA26', 'event_team', 'hospitality'),
    ].map((tab) => tab.label)

    expect(labels.length).toBeGreaterThan(0)

    const over = [...new Set(labels)].filter((label) => label.length * 7 > perTab)
    expect(over, 'labels that truncate at 360px — see the comment above').toEqual([
      'Hospitality',
      'Departures',
      'Check in / out',
    ])
  })
})
