import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { DURATION, DURATION_MS, EASE, WELCOME_CEILING_MS } from '@/lib/motion/tokens'

/**
 * The motion vocabulary is written twice — once as CSS custom properties in
 * globals.css (which drives every CSS transition) and once as numbers in
 * lib/motion/tokens.ts (which drives Motion, needing seconds and bezier
 * arrays rather than `ms` strings and `cubic-bezier()`).
 *
 * Two copies of a constant drift. This suite is what stops it: it parses the
 * real stylesheet and asserts the pairs still agree, so a change to one side
 * fails here instead of shipping as an animation that is subtly off from
 * every CSS transition next to it.
 */

const css = readFileSync(
  fileURLToPath(new URL('../src/app/globals.css', import.meta.url)),
  'utf8',
)

/** Reads a custom property's value from the `:root` block of globals.css. */
function cssVar(name: string): string {
  const match = css.match(new RegExp(`${name}\\s*:\\s*([^;]+);`))
  if (!match) throw new Error(`${name} not found in globals.css`)
  return match[1].trim()
}

/** `cubic-bezier(0.23, 1, 0.32, 1)` → `[0.23, 1, 0.32, 1]` */
function parseBezier(value: string): number[] {
  const match = value.match(/cubic-bezier\(([^)]+)\)/)
  if (!match) throw new Error(`not a cubic-bezier: ${value}`)
  return match[1].split(',').map((n) => Number(n.trim()))
}

describe('motion tokens mirror globals.css', () => {
  it.each([
    ['--ef-duration-press', DURATION_MS.feedback],
    ['--ef-duration-fade', DURATION_MS.fade],
    ['--ef-duration-enter', DURATION_MS.enter],
  ])('%s matches the TS duration', (name, expected) => {
    expect(cssVar(name)).toBe(`${expected}ms`)
  })

  it.each([
    ['--ef-ease', EASE.ledger],
    ['--ef-ease-seal', EASE.seal],
  ])('%s matches the TS easing array', (name, expected) => {
    expect(parseBezier(cssVar(name))).toEqual([...expected])
  })

  it('exposes seconds for Motion and ms for CSS, consistently', () => {
    expect(DURATION.feedback).toBeCloseTo(DURATION_MS.feedback / 1000, 6)
    expect(DURATION.fade).toBeCloseTo(DURATION_MS.fade / 1000, 6)
    expect(DURATION.enter).toBeCloseTo(DURATION_MS.enter / 1000, 6)
  })
})

describe('motion budget', () => {
  it('keeps every duration under the 400ms absolute ceiling', () => {
    for (const ms of Object.values(DURATION_MS)) {
      expect(ms).toBeLessThanOrEqual(400)
    }
  })

  it('keeps primary-action-path durations at or under 250ms', () => {
    // `enter` is deliberately excluded: it is an entry sequence, never an
    // action path. See the note in lib/motion/tokens.ts.
    expect(DURATION_MS.feedback).toBeLessThanOrEqual(250)
    expect(DURATION_MS.fade).toBeLessThanOrEqual(250)
  })

  it('holds the cold-start welcome to its 1.2s ceiling', () => {
    // Staff open this app dozens of times a shift; the ceiling is the whole
    // point of the feature having a budget at all.
    expect(WELCOME_CEILING_MS).toBeLessThanOrEqual(1200)
  })
})
