/**
 * Phone-width layout invariants (round-3 fixes).
 *
 * These are STRUCTURAL assertions, not a substitute for looking at a handset.
 * They exist because the two bugs they pin down were both silent: the filter
 * row put "Not coming" past the right edge with no scroll affordance, and the
 * family name broke mid-token at 1.5rem. Neither threw, neither failed a type
 * check, and neither is visible in a component snapshot — only a reader at
 * 360px sees them. A test that reads the same class strings a designer would
 * have to read is what stops them coming back.
 *
 * The measured numbers below are real: `Chip` is `px-4` (32px of horizontal
 * padding) at `text-sm font-medium whitespace-nowrap`, and the v2 content
 * column is `max-w-[480px] px-4` (`src/app/(app)/v2/[eventCode]/layout.tsx`),
 * so a 360px handset gives the row 360 − 32 = 328px of usable width, and a
 * 390px one gives 358px.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const FILTERS = 'src/app/(app)/v2/[eventCode]/rsvp/queue/ProgressAndFilters.tsx'
const CARD = 'src/app/(app)/v2/[eventCode]/rsvp/queue/CurrentFamilyCard.tsx'
const CHIP = 'src/components/ui/Chip.tsx'

/** The five filter labels, in render order, as the component declares them. */
const CHIP_LABELS = ['To call', 'Call back', 'Coming', 'Not coming', 'All']

/** Chip horizontal padding from `Chip.tsx` (`px-4`). */
const CHIP_PADDING = 32
/** The row gap between chips (`gap-2`). */
const CHIP_GAP = 8

/**
 * Conservative per-character width for Be Vietnam Pro at `text-sm` (14px)
 * `font-medium`. The app's UI font is the system stack (see `--font-sans`), so
 * 8px/char is above what any of these strings measures in practice — digits
 * and lowercase are narrower. Used only to prove the wrap lands in two or three
 * lines; it is not a claim about the exact pixel width.
 */
const CHAR_PX = 8

const chipWidth = (label: string) => label.length * CHAR_PX + CHIP_PADDING

/** How many lines `flex-wrap` needs for these chips in `available` px. */
function wrappedLines(labels: string[], available: number): number {
  let lines = 1
  let used = 0
  for (const label of labels) {
    const w = chipWidth(label)
    const next = used === 0 ? w : used + CHIP_GAP + w
    if (next > available) {
      lines += 1
      used = w
    } else {
      used = next
    }
  }
  return lines
}

describe('RSVP filter chips: wrap, never clip', () => {
  const src = read(FILTERS)

  /**
   * The chip row's own `className`, taken from the JSX attribute nearest to the
   * group's aria-label. Reading the attribute (not a comment above it) is what
   * keeps this honest: the file explains the old scroller in prose, and prose
   * must not be able to pass or fail the assertion.
   */
  const chipRowClass = (() => {
    const at = src.indexOf('aria-label="Filter queue"')
    const before = src.slice(0, at)
    const open = before.lastIndexOf('<div')
    const classNameAt = src.indexOf('className="', open)
    const end = src.indexOf('"', classNameAt + 'className="'.length)
    return src.slice(classNameAt + 'className="'.length, end)
  })()

  it('uses flex-wrap on the chip row', () => {
    expect(chipRowClass).toContain('flex-wrap')
  })

  it('has no horizontal scroller left on the chip row', () => {
    // The bug: `overflow-x-auto -mx-4 px-4` pushed the last chip off the right
    // edge with no visible affordance. A scroller is only acceptable with a
    // right-edge fade and scroll-snap; choosing the scroller that had neither
    // is what produced "Not comin".
    expect(chipRowClass).not.toContain('overflow-x-auto')
    expect(chipRowClass).not.toContain('-mx-4')
  })

  it('cannot compress a chip below its label width', () => {
    // `shrink-0` + `whitespace-nowrap` is what makes "Not coming" a whole word
    // rather than "Not comin". If a future edit drops either, a flex row will
    // happily squeeze and clip mid-word instead of wrapping.
    const chip = read(CHIP)
    expect(chip).toContain('shrink-0')
    expect(chip).toContain('whitespace-nowrap')
  })

  it('fits the five chips in two lines at 360px and 390px', () => {
    expect(wrappedLines(CHIP_LABELS, 360 - 32)).toBeLessThanOrEqual(2)
    expect(wrappedLines(CHIP_LABELS, 390 - 32)).toBeLessThanOrEqual(2)
  })

  it('still fits in three lines even at a 320px handset', () => {
    // 320px is below the supported floor, but a wrap that degrades to three
    // clean lines is still readable; a scroller would simply hide a filter.
    expect(wrappedLines(CHIP_LABELS, 320 - 32)).toBeLessThanOrEqual(3)
  })

  it('has no chip whose own label exceeds the narrowest usable width', () => {
    // A single chip wider than the row would overflow even when wrapped.
    for (const label of CHIP_LABELS) {
      expect(chipWidth(label)).toBeLessThan(320 - 32)
    }
  })
})

describe('Current family heading: shrinks and clamps, never breaks mid-token', () => {
  const src = read(CARD)

  it('is text-xl, not text-2xl', () => {
    const h2 = src.slice(src.indexOf('<h2'), src.indexOf('</h2>'))
    expect(h2).toContain('text-xl')
    expect(h2).not.toContain('text-2xl')
  })

  it('breaks long unbroken tokens instead of overflowing', () => {
    const h2 = src.slice(src.indexOf('<h2'), src.indexOf('</h2>'))
    expect(h2).toContain('break-words')
  })

  it('clamps to two lines so the Call button cannot be pushed down', () => {
    const h2 = src.slice(src.indexOf('<h2'), src.indexOf('</h2>'))
    expect(h2).toContain('line-clamp-2')
  })

  it('keeps the full name in the accessible label', () => {
    // The clamp is presentational. The name a screen reader announces, and the
    // name the Call button says, are both the untruncated string.
    expect(src).toContain('aria-label={`Current family: ${headName}`}')
    expect(src).toContain('`Call ${headName}')
  })
})
