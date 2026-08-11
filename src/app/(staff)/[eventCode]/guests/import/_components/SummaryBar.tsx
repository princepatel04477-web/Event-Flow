'use client'

import { useMemo } from 'react'

import type { ParsedFamilySheet } from '@/lib/import/families'

export interface SummaryBarProps {
  result: ParsedFamilySheet
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

interface Summary {
  families: number
  guests: number
  declined: number
  tentative: number
  notStarted: number
  missingMobile: number
  missingArrivalDate: number
  blankRowsSkipped: number
  orphans: number
  blockedFamilies: number
}

function summarise(result: ParsedFamilySheet): Summary {
  const { families, counts } = result

  return {
    families: counts.families,
    guests: counts.members,
    declined: families.filter((f) => f.rsvpStatus === 'declined').length,
    tentative: families.filter((f) => f.rsvpStatus === 'tentative').length,
    notStarted: families.filter((f) => f.rsvpStatus === 'not_started').length,
    missingMobile: families.filter((f) => f.primaryMobile === null).length,
    missingArrivalDate: families.filter((f) => f.arrival.travelDate === null).length,
    blankRowsSkipped: counts.blankRowsSkipped,
    orphans: counts.orphans,
    blockedFamilies: counts.blockedFamilies,
  }
}

/**
 * What the file amounts to, in the order a human acts on it.
 *
 * The two bands are deliberate. Orphan rows and families with no phone number
 * are the only numbers here anyone can DO anything about — an orphan means the
 * sheet has been re-sorted and somebody is about to be dropped, a missing
 * mobile means a family that cannot be dialled at all. Sitting them in a
 * uniform grid beside "blank rows skipped" is how they get skimmed past, so
 * they get their own band, at the top, with their own colour.
 */
export function SummaryBar({ result }: SummaryBarProps) {
  const s = useMemo(() => summarise(result), [result])

  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="import-attention" className="flex flex-col gap-2">
        <h3 id="import-attention" className="text-sm font-semibold text-fg">
          Needs a human
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Orphan rows"
            value={s.orphans}
            tone={s.orphans > 0 ? 'danger' : 'success'}
            note={
              s.orphans > 0
                ? 'Attached to no family. Listed below — fix the sheet, do not import around them.'
                : 'Every row belongs to a family.'
            }
            emphasis
          />
          <Stat
            label="No phone number"
            value={s.missingMobile}
            tone={s.missingMobile > 0 ? 'warning' : 'success'}
            note={
              s.missingMobile > 0
                ? 'These families cannot be dialled until a number is added.'
                : 'Every family can be dialled.'
            }
            emphasis
          />
        </div>
        {s.blockedFamilies > 0 ? (
          <p className="rounded-xl border border-danger bg-tint-danger px-3 py-2 text-sm font-medium text-danger">
            {s.blockedFamilies} famil{s.blockedFamilies === 1 ? 'y has' : 'ies have'} no name at all.
            A family cannot exist without one, so {s.blockedFamilies === 1 ? 'it' : 'they'} would be
            left out entirely.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="import-totals" className="flex flex-col gap-2">
        <h3 id="import-totals" className="text-sm font-semibold text-fg">
          What the file contains
        </h3>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Families" value={s.families} tone="info" />
          <Stat label="Guests" value={s.guests} tone="info" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Not started" value={s.notStarted} tone="neutral" />
          <Stat label="Tentative" value={s.tentative} tone="warning" />
          <Stat label="Declined" value={s.declined} tone="neutral" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="No arrival date" value={s.missingArrivalDate} tone="neutral" />
          <Stat label="Blank rows skipped" value={s.blankRowsSkipped} tone="neutral" />
        </div>
        {/* Nothing in this sheet can produce `confirmed`. Said out loud because
            a reader who sees "Not started: 231" will otherwise go looking for
            the confirmations they know some of these families already gave. */}
        <p className="text-xs text-subtle">
          No family is ever imported as <span className="font-medium text-muted">confirmed</span>. A
          confirmation only comes from a recorded call that a human has reviewed.
        </p>
      </section>
    </div>
  )
}

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
}

const TONE_BORDER: Record<Tone, string> = {
  neutral: 'border-border',
  success: 'border-border',
  warning: 'border-warning',
  danger: 'border-danger',
  info: 'border-border',
}

function Stat({
  label,
  value,
  tone,
  note,
  emphasis = false,
}: {
  label: string
  value: number
  tone: Tone
  note?: string
  emphasis?: boolean
}) {
  return (
    <div
      className={`rounded-xl border bg-surface p-3 ${
        emphasis ? TONE_BORDER[tone] : 'border-border'
      }`}
    >
      <div className={`text-2xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">{label}</div>
      {note ? <p className="mt-1 text-xs leading-snug text-subtle">{note}</p> : null}
    </div>
  )
}

export default SummaryBar
