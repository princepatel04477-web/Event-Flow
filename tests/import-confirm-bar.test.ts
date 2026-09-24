/**
 * B10 — "Confirm import" must sit ABOVE the tab bar, not under it.
 *
 * The reason this cannot be a rendering test: the bug is occlusion. The button
 * renders, `toBeVisible()` passes, and the tap lands on the tab bar on top of
 * it, so the import can never be committed. Only geometry catches that, which
 * is why `e2e/flows/h-admin.spec.ts` `(h3)` asserts the confirm element's
 * bottom edge against the tab bar's top edge. This file is the same assertion
 * without a browser: the confirm bar must carry the one utility that computes
 * the tab-bar offset, and must not go back to a bare `bottom-0`.
 *
 * `bottom-nav` and `bottom-bar` resolve to the SAME expression — `--ef-tabbar-h`
 * plus the gesture inset — which is the whole reason `--ef-tabbar-h` exists
 * (`globals.css`). Reading that out of the stylesheet as well means the test
 * fails if either half of the pair drifts.
 */
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8')

const PREVIEW_STEP =
  'src/app/(staff)/[eventCode]/guests/import/_components/PreviewStep.tsx'
const GLOBALS = 'src/app/globals.css'

describe('the import confirm bar clears the fixed tab bar (B10)', () => {
  const src = read(PREVIEW_STEP)

  /** The confirm bar's own `className`, read from the attribute. */
  const barClass = (() => {
    const at = src.indexOf('function ConfirmImportBar')
    const div = src.indexOf('<div', at)
    const from = src.indexOf('className="', div) + 'className="'.length
    return src.slice(from, src.indexOf('"', from))
  })()

  it('pins above the tab bar with bottom-nav', () => {
    expect(barClass).toContain('bottom-nav')
  })

  it('never goes back to a bare sticky bottom-0, which the tab bar covers', () => {
    expect(barClass).not.toMatch(/\bsticky bottom-0\b/)
  })

  it('drops the offset on desktop, where the tab bar is hidden', () => {
    // The tab bar is `md:hidden`, so the offset must be dropped there too —
    // otherwise the bar floats 64px above the bottom of a desktop viewport.
    expect(barClass).toContain('md:bottom-0')
  })

  it('sits on the same layer as the tab bar, later in the tree', () => {
    expect(barClass).toContain('z-40')
  })

  it('keeps the confirm button label the e2e spec looks for', () => {
    // `e2e/flows/h-admin.spec.ts` and `e2e/tier0.spec.ts` both resolve this
    // control by its exact accessible name.
    const at = src.indexOf('function ConfirmImportBar')
    expect(src.slice(at)).toContain('Confirm import')
  })
})

describe('the bottom-nav utility is the tab-bar offset (B10)', () => {
  const css = read(GLOBALS)

  /** The declarations inside an `@utility` block, without the wrapper. */
  const bodyOf = (utility: string) => {
    const at = css.indexOf(`@utility ${utility} {`)
    expect(at, `globals.css no longer defines @utility ${utility}`).toBeGreaterThan(-1)
    const open = css.indexOf('{', at)
    const close = css.indexOf('\n}', open)
    expect(close, `@utility ${utility} is not closed`).toBeGreaterThan(open)
    return css.slice(open + 1, close)
  }

  it('measures bottom-nav from --ef-tabbar-h', () => {
    expect(bodyOf('bottom-nav')).toContain('--ef-tabbar-h')
  })

  it('resolves bottom-nav to the same offset BottomBar uses', () => {
    // Compared normalised: whitespace and line wrapping are the stylesheet's
    // business, the expression is the design's.
    const squeeze = (s: string) => s.replace(/\s+/g, '')
    expect(squeeze(bodyOf('bottom-nav'))).toBe(squeeze(bodyOf('bottom-bar')))
  })
})
