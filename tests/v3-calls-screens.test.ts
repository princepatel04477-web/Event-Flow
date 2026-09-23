import { createElement as h, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CurrentFamilyCard } from '@/app/(app)/v2/[eventCode]/rsvp/queue/CurrentFamilyCard'
import { FamilyQueueSheet } from '@/app/(app)/v2/[eventCode]/rsvp/queue/FamilyQueueSheet'
import { InlineCaptureStep } from '@/app/(app)/v2/[eventCode]/rsvp/queue/InlineCaptureStep'
import { OutcomeButtons } from '@/app/(app)/v2/[eventCode]/rsvp/queue/OutcomeButtons'
import { AlternateOutcomeSheet } from '@/app/(app)/v2/[eventCode]/rsvp/queue/AlternateOutcomeSheet'
import { RsvpLogForm } from '@/app/(staff)/[eventCode]/rsvp/status/[groupId]/RsvpLogForm'
import { CampaignBoard } from '@/components/rsvp/CampaignBoard'
import {
  ReviewPanel,
  type ReviewFieldDef,
} from '@/components/review/ReviewPanel'
import { EMPTY_LEG, emptyFormValues } from '@/lib/rsvp-log'
import { EMPTY_LEG_FORM_VALUES } from '@/lib/review/payload'
import type { GuestGroupRow } from '@/lib/call/types'

/**
 * Server-render assertions for the v3 Calls and Review screens.
 *
 * WHY THESE EXIST INSTEAD OF SCREENSHOTS. This sandbox denies the named pipes
 * Chromium (and Firefox) create at launch — `browserType.launch: spawn EPERM`,
 * and Chromium's own log is `mojo platform_channel: Access is denied` — so the
 * SPEC §5 requirement to LOOK at a 360px and a 390px shot of every screen could
 * not be met here. The escalation to a wider sandbox was refused for lack of an
 * approval channel. What IS available is the rendered tree, and the rules that
 * break at 360px are mostly structural: a chip row that scrolls instead of
 * wrapping, a second maroon commit competing with the real one, a fixed bottom
 * bar whose height the content never reserves.
 *
 * These are NOT a substitute for looking at a handset. They are what could be
 * checked without one, and this file says so rather than implying more.
 * `tests/v3-shell-render.test.ts` carries the same note for the shared kit.
 *
 * Written with `createElement` because the suite's `include` is
 * `tests/**\/*.test.ts` — a `.tsx` file is not collected.
 */

// Both screens are client components that call `useRouter()` on render.
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    prefetch: () => {},
    back: () => {},
  }),
  usePathname: () => '/SHARMA26/rsvp/queue',
  useSearchParams: () => new URLSearchParams(),
}))

/*
 * The screens import the server actions they call (`saveRsvpLog`,
 * `releaseGroupAfterCall`, `acceptExtractionWithAudit`, ...), and those reach
 * `@/lib/supabase/server`, which is `server-only`. `server-only` throws on
 * import outside a React Server Component graph, which is exactly what this
 * file is not. The actions are never CALLED here — the tree is only rendered —
 * so neutralising the guard keeps the render honest without pretending a
 * server action ran.
 */
vi.mock('server-only', () => ({}))

const render = (el: ReactElement) => renderToStaticMarkup(el)

/** Every class token in the tree, so a rule can be counted rather than grepped. */
function classTokens(html: string): string[] {
  return [...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean)
}

function countClass(html: string, token: string): number {
  return classTokens(html).filter((t) => t === token).length
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const queueRow = {
  group_id: '11111111-1111-1111-1111-111111111111',
  head_name: 'Ravi Kumar Sharma',
  primary_mobile: '9876543210',
  expected_pax: 6,
  confirmed_pax: null,
  side: 'bride',
  group_type: 'family',
  rsvp_status: 'not_started',
  attempt_count: 0,
  next_callback_at: null,
  is_locked: false,
  locked_until: null,
  locked_by_staff: null,
  priority: 0,
  last_attempt_at: null,
}

const outOfScope = (value: unknown) => value as never

const groupRow = {
  id: '11111111-1111-1111-1111-111111111111',
  head_name: 'Ravi Kumar Sharma',
  primary_mobile: '9876543210',
  group_type: 'family',
  rsvp_status: 'not_started',
  locked_by: null,
  locked_by_staff: null,
} as unknown as GuestGroupRow

const reviewFields: ReviewFieldDef[] = [
  {
    path: 'rsvpStatus',
    modelPath: 'rsvp_status',
    label: 'RSVP status',
    kind: 'select',
    aiDisplay: 'confirmed',
    aiJson: 'confirmed',
  },
  {
    path: 'arrival.date',
    modelPath: 'arrival.date',
    label: 'Arrival Date',
    kind: 'date',
    aiDisplay: '2026-12-20',
    aiJson: '2026-12-20',
  },
]

/* ------------------------------------------------------------------ */
/* Calls — the current family card                                     */
/* ------------------------------------------------------------------ */

describe('Calls: current family card', () => {
  const html = render(
    h(CurrentFamilyCard, {
      row: outOfScope(queueRow),
      dialling: false,
      lock: null,
      onCall: () => {},
    }),
  )

  it('names the family and keeps the full name in the Call control', () => {
    expect(html).toContain('Ravi Kumar Sharma')
    expect(html).toContain('aria-label="Call Ravi Kumar Sharma"')
  })

  it('carries the relation and the invited count on ONE meta line', () => {
    expect(html).toContain('Family')
    expect(html).toContain('6 invited')
  })

  it('renders the Call control green, and as the card’s only filled control', () => {
    expect(html).toContain('bg-ledger-green')
    expect(countClass(html, 'bg-brand')).toBe(0)
  })

  it('omits the call-count line entirely at zero attempts', () => {
    expect(html).not.toContain('calls so far')
  })
})

/* ------------------------------------------------------------------ */
/* Calls — the three outcomes and the alternate link                   */
/* ------------------------------------------------------------------ */

describe('Calls: outcome controls', () => {
  const html = render(
    h(OutcomeButtons, {
      activeOutcome: null,
      onSelectComing: () => {},
      onSelectNotComing: () => {},
      onSelectNoAnswer: () => {},
      onOpenAlternate: () => {},
    }),
  )

  it('offers exactly the three one-tap outcomes', () => {
    expect(html).toContain('Coming')
    expect(html).toContain('Not coming')
    expect(html).toContain('No answer')
  })

  it('keeps call-back and maybe behind ONE text link, not two more buttons', () => {
    expect(html).toContain('Call back later or Maybe')
    expect((html.match(/<button/g) ?? []).length).toBe(4) // three outcomes + the link
  })

  it('commits nothing — no maroon primary anywhere in this block', () => {
    expect(countClass(html, 'bg-brand')).toBe(0)
  })
})

/* ------------------------------------------------------------------ */
/* Calls — the two sheets                                              */
/* ------------------------------------------------------------------ */

describe('Calls: the queue sheet', () => {
  const html = render(
    h(FamilyQueueSheet, {
      open: true,
      onClose: () => {},
      rows: [outOfScope(queueRow)],
      currentGroupId: null,
      activeFilter: 'to_call',
      onFilterChange: () => {},
      onSelectFamily: () => {},
    }),
  )

  it('wraps its filter chips instead of scrolling them off the edge', () => {
    const at = html.indexOf('aria-label="Filter queue"')
    expect(at).toBeGreaterThan(-1)
    const before = html.slice(0, at)
    const open = before.lastIndexOf('<div')
    const cls = html.slice(html.indexOf('class="', open) + 7)
    const classes = cls.slice(0, cls.indexOf('"'))
    expect(classes).toContain('flex-wrap')
    expect(classes).not.toContain('overflow-x-auto')
  })

  it('renders a whole-row tap target per family with a status WORD', () => {
    expect(html).toContain('Ravi Kumar Sharma')
    expect(html).toContain('<button')
    expect(html).toContain('min-h-16')
  })
})

describe('Calls: the call-back / maybe sheet', () => {
  const html = render(
    h(AlternateOutcomeSheet, {
      open: true,
      onClose: () => {},
      onSaveCallback: () => {},
      onPickMaybe: () => {},
    }),
  )

  it('has ONE maroon commit and one secondary', () => {
    expect(countClass(html, 'bg-brand')).toBe(1)
    expect(html).toContain('Save call back')
    expect(html).toContain('Maybe — capture details')
  })
})

/* ------------------------------------------------------------------ */
/* Calls — the inline capture step                                     */
/* ------------------------------------------------------------------ */

describe('Calls: inline capture step', () => {
  const html = render(
    h(InlineCaptureStep, {
      status: 'confirmed',
      family: null,
      expectedPax: 6,
      startsOn: '2026-12-20',
      endsOn: '2026-12-24',
      onSave: () => {},
      onCancel: () => {},
    }),
  )

  it('counts with steppers, never a text input', () => {
    expect(html).toContain('aria-label="Decrease Adults"')
    expect(html).toContain('aria-label="Increase Kids"')
  })

  it('offers the four arrival time slots and the four travel modes', () => {
    for (const slot of ['Morning', 'Afternoon', 'Evening', 'Night']) {
      expect(html).toContain(slot)
    }
    for (const mode of ['Train', 'Flight', 'Bus', 'By road']) {
      expect(html).toContain(mode)
    }
  })

  it('renders its own commit when the screen has not deferred it', () => {
    expect(html).toContain('Save · next family')
  })
})

/* ------------------------------------------------------------------ */
/* RSVP log form (rsvp/status/[groupId])                               */
/* ------------------------------------------------------------------ */

describe('RSVP log form', () => {
  const values = { ...emptyFormValues(), arrival: { ...EMPTY_LEG } }
  const baseProps = {
    eventId: 'e1',
    eventCode: 'SHARMA26',
    viewerId: 'v1',
    group: groupRow,
    attempts: [],
    initialValues: values,
    inFlightAttempt: null,
    hasQueueNext: true,
  }

  const html = render(h(RsvpLogForm, baseProps))

  it('offers the five outcomes in the caller’s words', () => {
    for (const word of ['Coming', 'Not coming', 'No answer', 'Call back', 'Maybe']) {
      expect(html).toContain(word)
    }
  })

  it('has exactly ONE solid maroon commit — the bottom bar', () => {
    expect(countClass(html, 'bg-brand')).toBe(1)
    expect(html).toContain('Save outcome')
  })

  it('reserves room for the fixed bar so the last row is reachable', () => {
    expect(html).toContain('pb-nav-bottombar')
  })

  it('wraps the outcome chips rather than clipping the fifth one', () => {
    const at = html.indexOf('aria-label="What happened"')
    const before = html.slice(0, at)
    const open = before.lastIndexOf('<div')
    const cls = html.slice(html.indexOf('class="', open) + 7)
    expect(cls.slice(0, cls.indexOf('"'))).toContain('flex-wrap')
  })

  it('shows no travel panel until an outcome is chosen', () => {
    expect(html).not.toContain('Needs pickup')
  })
})

/* ------------------------------------------------------------------ */
/* Review panel                                                        */
/* ------------------------------------------------------------------ */

describe('Review panel', () => {
  const html = render(
    h(ReviewPanel, {
      eventCode: 'SHARMA26',
      extractionId: 'x1',
      headName: 'Ravi Kumar Sharma',
      primaryMobile: '9876543210',
      side: 'bride',
      expectedPax: 6,
      fields: reviewFields,
      fieldEvidence: {},
      values: {
        rsvpStatus: 'confirmed',
        confirmedPax: '6',
        side: 'bride',
        remarks: 'wheelchair for mother',
        arrival: {
          mode: 'air',
          date: '2026-12-20',
          time: '10:30',
          reference: '6E 5074',
          point: 'Ahmedabad T2',
          pax: '6',
        },
        departure: { ...EMPTY_LEG_FORM_VALUES },
      },
      existingGroup: { rsvpStatus: null, confirmedPax: null, side: null, remarks: null },
      existingArrival: null,
      existingDeparture: null,
      audio: null,
      transcriptText: null,
      transcriptSegments: null,
      confidence: { rsvp_status: 0.42, 'arrival.date': 0.95 },
    }),
  )

  it('names the family and its one meta line', () => {
    expect(html).toContain('Ravi Kumar Sharma')
    expect(html).toContain('6 expected')
  })

  it('gives every field the same three chips — accept, edit, reject', () => {
    expect((html.match(/>Accept</g) ?? []).length).toBe(reviewFields.length)
    expect((html.match(/>Edit</g) ?? []).length).toBe(reviewFields.length)
    expect((html.match(/>Reject</g) ?? []).length).toBe(reviewFields.length)
  })

  it('does NOT put a maroon commit on every field', () => {
    // The v2 panel gave each field a primary "Accept"; a 16-field extraction
    // then had 16 commits and the real one was invisible. The only maroon on
    // this screen is the bottom bar's.
    expect(countClass(html, 'bg-brand')).toBe(1)
  })

  it('marks the low-confidence field and shows its figure', () => {
    expect(html).toContain('aria-label="RSVP status, low confidence"')
    expect(html).toContain('42%')
    expect(html).toContain('95%')
  })

  it('keeps the commit reachable above the fixed bar', () => {
    expect(html).toContain('pb-nav-bottombar')
    expect(html).toContain('Review &amp; commit')
  })
})

/* ------------------------------------------------------------------ */
/* Campaigns                                                           */
/* ------------------------------------------------------------------ */

describe('Campaign board', () => {
  it('offers one import link and nothing else when there are no families', () => {
    const html = render(
      h(CampaignBoard, {
        eventId: 'e1',
        eventCode: 'SHARMA26',
        campaigns: [],
        guestCount: 0,
        staffCount: 0,
        grokConfigured: false,
      }),
    )
    expect(html).toContain('No families to call yet')
    expect(html).toContain('/SHARMA26/guests/import')
    expect(countClass(html, 'bg-brand')).toBe(1)
  })
})
