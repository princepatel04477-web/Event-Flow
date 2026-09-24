import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CurrentFamilyCard } from '@/app/(app)/v2/[eventCode]/rsvp/queue/CurrentFamilyCard'
import type { QueueRow } from '@/app/(app)/v2/[eventCode]/rsvp/queue/types'

/**
 * The "Call" button on Calls, rendered to a string.
 *
 * WHY THIS TEST EXISTS. The button shipped as an off-white ghost on a white
 * card: the caller passed `className="bg-ledger-green text-paper …"` OVER
 * `variant="secondary"`, and `cn()` concatenates rather than resolving Tailwind
 * conflicts — so BOTH fills were in the class attribute and the stylesheet
 * decided. `.bg-surface` is emitted AFTER `.bg-ledger-green`, so the green lost
 * the fill and only `text-paper` survived, giving near-white text on the
 * secondary's white surface. Nothing in a diff shows that; it shows up on a
 * phone, on a card, in a corridor.
 *
 * The class order is the whole bug, so the assertions are on the class list of
 * the rendered button rather than on the source: one fill, one text colour, and
 * a disabled state that reads as inert rather than as a green "go".
 *
 * Written with `createElement` rather than JSX because the suite's include glob
 * is `tests/**\/*.test.ts` — a `.tsx` file is not collected, the same reason
 * `tests/v3-shell-render.test.ts` gives.
 */

const render = (el: ReactElement) => renderToStaticMarkup(el)

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    group_id: '11111111-1111-4111-8111-111111111111',
    head_name: 'Ravi Kumar Sharma',
    primary_mobile: '9825012345',
    group_type: 'family',
    side: 'bride',
    expected_pax: 6,
    confirmed_pax: null,
    rsvp_status: null,
    priority: null,
    is_locked: null,
    locked_by_staff: null,
    locked_until: null,
    attempt_count: 0,
    last_outcome: null,
    next_callback_at: null,
    remarks: null,
    ...overrides,
  }
}

/** The one `<button>` in the card, as a tag string, and its class list. */
function callButton(html: string): { tag: string; classes: string[] } {
  const start = html.indexOf('<button')
  if (start === -1) throw new Error('the card rendered no button at all')
  const tag = html.slice(start, html.indexOf('>', start) + 1)
  const classes = (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(/\s+/).filter(Boolean)
  return { tag, classes }
}

describe('CurrentFamilyCard — the Call button', () => {
  it('is a solid green fill with white text and icon when a number can be dialled', () => {
    const html = render(
      h(CurrentFamilyCard, { row: row(), dialling: false, lock: null, onCall: () => {} }),
    )
    const { tag, classes } = callButton(html)

    expect(classes).toContain('bg-ledger-green')
    expect(classes).toContain('text-white')
    // A solid fill: the transparent border is what keeps it from growing the
    // secondary's 1.5px hairline, and there is no white surface left to
    // override the green.
    expect(classes).toContain('border-transparent')
    expect(tag).not.toContain('disabled=""')
    expect(html).toContain('>Call</button>')

    // ONE fill and ONE text COLOUR. Two of either is the bug: which one wins is
    // then decided by the generated stylesheet's order, not by this file. The
    // one size token in the list is named rather than pattern-matched, because
    // `text-sm` IS a `text-` class and counting it as a colour would make the
    // assertion vacuous.
    expect(classes.filter((c) => c.startsWith('bg-'))).toEqual(['bg-ledger-green'])
    expect(classes.filter((c) => c.startsWith('text-') && c !== 'text-sm')).toEqual(['text-white'])
    expect(classes).not.toContain('bg-surface')
    expect(classes).not.toContain('text-ink')
  })

  it('lets the icon take the button’s colour, so it is white too', () => {
    const html = render(
      h(CurrentFamilyCard, { row: row(), dialling: false, lock: null, onCall: () => {} }),
    )
    const { classes } = callButton(html)
    // The icon is a stroke icon on `currentColor`; the class list above is what
    // decides that colour, so the two assertions only mean something together.
    expect(html).toContain('stroke="currentColor"')
    expect(classes).toContain('text-white')
  })

  it('greys out and goes inert while there is nothing to dial', () => {
    const html = render(
      h(CurrentFamilyCard, {
        row: row({ primary_mobile: null }),
        dialling: false,
        lock: null,
        onCall: () => {},
      }),
    )
    const { tag, classes } = callButton(html)

    expect(tag).toContain('disabled=""')
    // A disabled control must not still look like the green "go": the neutral
    // surface and the muted ink are `:disabled` rules, so they outrank the
    // variant's own fill whatever order the stylesheet emits them in.
    expect(classes).toContain('disabled:bg-surface-2')
    expect(classes).toContain('disabled:text-muted')
    expect(html).toContain('No phone number on file for this family.')
    // Still ONE fill in the enabled rule set: the neutral one is the disabled
    // state of the same variant, not a second colour competing with it.
    expect(classes.filter((c) => c.startsWith('bg-'))).toEqual(['bg-ledger-green'])
  })

  it('goes inert and says "Calling…" while the dial is in flight', () => {
    const html = render(
      h(CurrentFamilyCard, { row: row(), dialling: true, lock: null, onCall: () => {} }),
    )
    const { tag } = callButton(html)

    expect(tag).toContain('disabled=""')
    expect(html).toContain('Calling…')
    expect(html).not.toContain('>Call</button>')
  })
})
