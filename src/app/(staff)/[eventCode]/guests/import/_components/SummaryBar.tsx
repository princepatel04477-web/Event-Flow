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
  missingArrivalDate: number
  blankRowsSkipped: number
  blockedFamilies: number
  groomFather: number
  groomMother: number
  groomGeneral: number
  brideFather: number
  brideMother: number
  brideGeneral: number
  bothOrOther: number
  unassignedSide: number
}

function summarise(result: ParsedFamilySheet): Summary {
  const { families, counts } = result

  return {
    families: counts.families,
    guests: counts.members,
    declined: families.filter((f) => f.rsvpStatus === 'declined').length,
    tentative: families.filter((f) => f.rsvpStatus === 'tentative').length,
    notStarted: families.filter((f) => f.rsvpStatus === 'not_started').length,
    missingArrivalDate: families.filter((f) => f.arrival.travelDate === null).length,
    blankRowsSkipped: counts.blankRowsSkipped,
    blockedFamilies: counts.blockedFamilies,
    groomFather: families.filter((f) => f.side === 'groom' && f.subSide === 'father').length,
    groomMother: families.filter((f) => f.side === 'groom' && f.subSide === 'mother').length,
    groomGeneral: families.filter((f) => f.side === 'groom' && f.subSide === null).length,
    brideFather: families.filter((f) => f.side === 'bride' && f.subSide === 'father').length,
    brideMother: families.filter((f) => f.side === 'bride' && f.subSide === 'mother').length,
    brideGeneral: families.filter((f) => f.side === 'bride' && f.subSide === null).length,
    bothOrOther: families.filter((f) => f.side === 'both' || f.side === 'other').length,
    unassignedSide: families.filter((f) => f.side === null).length,
  }
}

/**
 * What the parsed file amounts to before committing the import.
 */
export function SummaryBar({ result }: SummaryBarProps) {
  const s = useMemo(() => summarise(result), [result])

  return (
    <div className="flex flex-col gap-3">
      {s.blockedFamilies > 0 ? (
        <p className="rounded-xl border border-danger bg-tint-danger px-3 py-2 text-sm font-medium text-danger">
          {s.blockedFamilies} famil{s.blockedFamilies === 1 ? 'y has' : 'ies have'} no name at all.
          A family cannot exist without one, so {s.blockedFamilies === 1 ? 'it' : 'they'} would be
          left out entirely.
        </p>
      ) : null}

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
        <div className="grid grid-cols-2 gap-2">
          {s.groomFather > 0 ? (
            <Stat label="Groom's Father Side" value={s.groomFather} tone="info" />
          ) : null}
          {s.groomMother > 0 ? (
            <Stat label="Groom's Mother Side" value={s.groomMother} tone="info" />
          ) : null}
          {s.groomGeneral > 0 ? (
            <Stat label="Groom Side (unsplit)" value={s.groomGeneral} tone="info" />
          ) : null}
          {s.brideFather > 0 ? (
            <Stat label="Bride's Father Side" value={s.brideFather} tone="info" />
          ) : null}
          {s.brideMother > 0 ? (
            <Stat label="Bride's Mother Side" value={s.brideMother} tone="info" />
          ) : null}
          {s.brideGeneral > 0 ? (
            <Stat label="Bride Side (unsplit)" value={s.brideGeneral} tone="info" />
          ) : null}
          {s.bothOrOther > 0 ? (
            <Stat label="Both / Other side" value={s.bothOrOther} tone="neutral" />
          ) : null}
          {s.unassignedSide > 0 ? (
            <Stat
              label="Side not assigned"
              value={s.unassignedSide}
              tone="warning"
              note="Pick Groom / Bride side above before confirming."
              emphasis
            />
          ) : null}
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
