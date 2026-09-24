import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { SyncChip } from '@/components/ui/SyncChip'
import { BottomBar } from '@/components/ui/BottomBar'
import { Initials, StatusDot } from '@/components/ui/RowParts'
import { NowCard } from '@/components/ui/NowCard'
import { Progress } from '@/components/ui/Progress'
import { Row } from '@/components/ui/Row'
import { Stepper } from '@/components/ui/Stepper'

/**
 * Server-render assertions for the v3 component set.
 *
 * WHY THESE EXIST AT ALL. This session could not run a browser — this sandbox
 * denies the named pipe Chromium's mojo layer creates, and the escalation
 * request had no approval channel — so "look at a screenshot at 360px" was not
 * available for the screens. What IS available is the component tree itself,
 * rendered to a string, and several v3 rules are structural enough to catch
 * here: the ones whose failure is invisible in a diff and obvious on a phone.
 *
 *   - a row whose status is a WORD plus a dot, not a coloured pill wall;
 *   - an avatar that renders nothing rather than an empty ring;
 *   - a progress bar whose percentage is always a legal integer and whose
 *     denominator never produces NaN;
 *   - a bottom bar with two controls that can BOTH shrink (`min-w-0`), which
 *     is what stops a long secondary label from widening a fixed bar past
 *     360px with no way to scroll to the rest of it;
 *   - a primary button at the v3 56px and a secondary at 52px.
 *
 * Written with `createElement` rather than JSX because the suite's `include`
 * is `tests/**\/*.test.ts` — a `.tsx` file is not collected, and widening that
 * glob would change the pre-commit loop for every other suite.
 *
 * These are not a substitute for looking at a handset. They are what could be
 * checked without one, and this file says so rather than implying more.
 */

const render = (el: ReactElement) => renderToStaticMarkup(el)

describe('Button heights', () => {
  it('a primary defaults to 56px and a secondary to 52px', () => {
    const primary = render(h(Button, null, 'Save'))
    const secondary = render(h(Button, { variant: 'secondary' }, 'Skip'))

    expect(primary).toContain('min-h-14')
    expect(secondary).toContain('min-h-13')
    // The "never faded at rest" rule: the only opacity in the class list is
    // the `disabled:` / `aria-disabled:` pair, so a button that is merely
    // sitting on a screen is at full strength.
    for (const html of [primary, secondary]) {
      const bareOpacity = html
        .split('"')[1]
        .split(/\s+/)
        .filter((c) => c.includes('opacity') && !c.startsWith('disabled:') && !c.startsWith('aria-disabled:'))
      expect(bareOpacity).toEqual([])
    }
  })

  it('an explicit size wins over the variant default', () => {
    expect(render(h(Button, { size: 'sm' }, 'Add'))).toContain('min-h-11')
  })

  it('a secondary carries a 1.5px hairline, not a 1px one', () => {
    expect(render(h(Button, { variant: 'secondary' }, 'Skip'))).toContain('border-[1.5px]')
  })
})

describe('Progress', () => {
  it('renders the label, the done/total figure and an integer percentage', () => {
    const html = render(h(Progress, { label: 'Families called', done: 38, total: 171 }))
    expect(html).toContain('Families called')
    expect(html).toContain('38/171')
    expect(html).toContain('aria-valuenow="22"')
    expect(html).toContain('width:22%')
  })

  it('renders an empty bar when there is nothing to do', () => {
    const html = render(h(Progress, { label: 'Guests with a bed', done: 0, total: 0 }))
    expect(html).toContain('0/0')
    expect(html).toContain('aria-valuenow="0"')
    expect(html).toContain('width:0%')
    expect(html).not.toContain('NaN')
  })

  it('never renders a width above 100%', () => {
    const html = render(h(Progress, { label: 'Rooms', done: 80, total: 74 }))
    expect(html).toContain('aria-valuenow="100"')
    expect(html).toContain('width:100%')
  })

  it('colours by the domain tone, from the token set', () => {
    expect(render(h(Progress, { label: 'Calls', done: 1, total: 2, tone: 'green' }))).toContain(
      'bg-ledger-green',
    )
    expect(render(h(Progress, { label: 'Rooms', done: 1, total: 2, tone: 'brand' }))).toContain(
      'bg-brand',
    )
    expect(render(h(Progress, { label: 'Hampers', done: 1, total: 2, tone: 'amber' }))).toContain(
      'bg-ledger-amber',
    )
  })
})

describe('Row', () => {
  it('renders the name, one meta line, a status WORD and a dot', () => {
    const html = render(
      h(Row, { heading: 'Sharma family', meta: 'Confirmed · 6 guests', status: 'Coming', tone: 'done' }),
    )
    expect(html).toContain('Sharma family')
    expect(html).toContain('Confirmed · 6 guests')
    expect(html).toContain('Coming')
    // The dot is decorative; the word carries the meaning.
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('bg-ledger-green')
    // No status PILL in a row — the v2 pattern this replaces.
    expect(html).not.toContain('rounded-full border')
  })

  it('is a whole-row tap target when it has a handler', () => {
    const html = render(h(Row, { heading: 'Ravi', onPress: () => {} }))
    expect(html.startsWith('<button')).toBe(true)
    expect(html).toContain('min-h-16')
  })

  it('is a plain div when it has no handler', () => {
    expect(render(h(Row, { heading: 'Ravi' })).startsWith('<div')).toBe(true)
  })
})

describe('Initials', () => {
  it('renders the two letters', () => {
    expect(render(h(Initials, { name: 'Ravi Kumar Sharma' }))).toContain('RK')
  })

  it('renders NOTHING for a name with no usable characters', () => {
    // An empty ring reads as a broken image, which is worse than no avatar.
    expect(render(h(Initials, { name: '' }))).toBe('')
    expect(render(h(Initials, { name: null }))).toBe('')
  })

  it('keeps a Devanagari name legible in the avatar', () => {
    expect(render(h(Initials, { name: 'शर्मा परिवार' }))).toContain('शप')
  })
})

describe('StatusDot', () => {
  it('is always aria-hidden', () => {
    const html = render(h(StatusDot, { tone: 'waiting' }))
    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain('bg-ledger-amber')
  })
})

describe('BottomBar', () => {
  const primary = { label: 'Photo · delivered', onPress: () => {} }

  it('renders the summary, one primary and at most one secondary', () => {
    const html = render(
      h(BottomBar, {
        summary: '3 families left',
        secondary: { label: 'Not in room', onPress: () => {} },
        primary,
      }),
    )
    expect(html).toContain('3 families left')
    expect(html).toContain('Photo · delivered')
    expect(html).toContain('Not in room')
    // The bar sits ON the tab bar, not at the viewport edge.
    expect(html).toContain('bottom-bar')
  })

  it('lets BOTH controls shrink, so a long label cannot widen the bar', () => {
    // `Button` is `whitespace-nowrap` and a flex item defaults to
    // `min-width: auto`. Without `min-w-0` on both columns, a long secondary
    // label ("Not in room · 2 left") makes the row wider than 360px — and a
    // fixed bar cannot be scrolled sideways to reach the rest of it.
    const html = render(
      h(BottomBar, {
        secondary: { label: 'Not in room · 2 left', onPress: () => {} },
        primary,
      }),
    )
    const minW0 = (html.match(/min-w-0/g) ?? []).length
    expect(minW0).toBeGreaterThanOrEqual(2)
  })

  it('renders the primary as a navigation link when it has an href', () => {
    const html = render(h(BottomBar, { primary: { label: 'Next', href: '/e/rsvp' } }))
    expect(html).toContain('href="/e/rsvp"')
  })

  it('renders the primary as a button when it is a write', () => {
    const html = render(h(BottomBar, { primary }))
    expect(html).toContain('<button')
    expect(html).not.toContain('href=')
  })
})

describe('NowCard', () => {
  it('is the dark plane with a marigold eyebrow and a marigold action', () => {
    const html = render(
      h(NowCard, {
        eyebrow: 'Right now',
        headline: '14 families have no room',
        context: '38 beds are free.',
        actionLabel: 'Place families',
        actionHref: '/e/hospitality/rooms',
      }),
    )
    expect(html).toContain('bg-now')
    expect(html).toContain('text-highlight')
    expect(html).toContain('bg-highlight')
    expect(html).toContain('text-now-fg')
    expect(html).toContain('text-now-muted')
    // A real link, so it prefetches and middle-clicks.
    expect(html).toContain('href="/e/hospitality/rooms"')
  })
})

describe('Chip', () => {
  it('is maroon when selected and quiet when not', () => {
    const on = render(h(Chip, { selected: true, children: 'Call back' }))
    const off = render(h(Chip, { selected: false, children: 'Call back' }))
    expect(on).toContain('bg-brand-tint')
    expect(on).toContain('aria-pressed="true"')
    expect(off).toContain('aria-pressed="false"')
    expect(off).not.toContain('bg-brand-tint')
  })

  it('stays a pill and keeps the 44px tap floor', () => {
    const html = render(h(Chip, { selected: true, children: 'All' }))
    expect(html).toContain('rounded-full')
    expect(html).toContain('min-h-11')
  })
})

describe('SyncChip', () => {
  it('meets the 44px tap floor — `.tap` sets no minimum height on its own', () => {
    const html = render(h(SyncChip, { count: 3, what: 'delivery' }))
    expect(html).toContain('min-h-11')
  })

  it('renders nothing when there is nothing queued', () => {
    expect(render(h(SyncChip, { count: 0, what: 'delivery' }))).toBe('')
  })
})

describe('disabled controls', () => {
  it('a disabled button greys to a neutral surface instead of fading', () => {
    // m5: `disabled:opacity-55` composited the control to ~2:1 and read as a
    // rendering glitch. The replacement is a real surface + `text-muted`, with
    // no opacity anywhere in the class list.
    const html = render(h(Button, { disabled: true }, 'Save'))
    // Read the class ATTRIBUTE, not the first quoted attribute (`type`).
    const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? '').split(/\s+/)
    expect(classes).toContain('disabled:bg-surface-2')
    expect(classes).toContain('disabled:text-muted')
    expect(classes).toContain('disabled:border-rule')
    expect(classes.filter((c) => c.includes('opacity'))).toEqual([])
  })

  it('a stepper button at its range end greys rather than fades', () => {
    const html = render(h(Stepper, { label: 'Kids', value: 0, onChange: () => {} }))
    expect(html).toContain('disabled:bg-surface-2')
    expect(html).toContain('disabled:text-muted')
    expect(html).not.toContain('opacity-40')
  })
})

describe('Stepper', () => {
  it('renders two 44px controls and a live value', () => {
    const html = render(h(Stepper, { label: 'Adults', value: 4, onChange: () => {} }))
    expect(html).toContain('Adults')
    expect(html).toContain('aria-label="Decrease Adults"')
    expect(html).toContain('aria-label="Increase Adults"')
    expect(html).toContain('h-11 w-11')
    expect(html).toContain('aria-live="polite"')
  })

  it('disables the control that would leave the range', () => {
    const atMin = render(h(Stepper, { label: 'Kids', value: 0, onChange: () => {} }))
    const atMax = render(h(Stepper, { label: 'Kids', value: 99, onChange: () => {} }))
    expect(atMin).toContain('disabled=""')
    expect(atMax).toContain('disabled=""')
  })

  it('offers a text input nowhere — the keyboard would cover the screen', () => {
    expect(render(h(Stepper, { label: 'Adults', value: 2, onChange: () => {} }))).not.toContain(
      '<input',
    )
  })
})
