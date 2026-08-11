'use client'

import { ChevronDownIcon } from '@/components/icons'
import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import type { ImportRsvpStatus } from '@/lib/import/normalize'
import type { ParsedFamily, ParsedTravelLeg } from '@/lib/import/families'
import { formatIsoForHumans } from '@/lib/import/cells'

export interface FamilyListProps {
  families: ParsedFamily[]
}

const STATUS_META: Record<ImportRsvpStatus, { label: string; tone: BadgeTone }> = {
  not_started: { label: 'Not started', tone: 'neutral' },
  tentative: { label: 'Tentative', tone: 'warning' },
  declined: { label: 'Declined', tone: 'neutral' },
}

/**
 * Every family the parser found, collapsed.
 *
 * `<details>`/`<summary>` rather than a React accordion, on purpose: it needs
 * no state, no JavaScript and no hydration to open, it survives a cheap phone
 * mid-scroll, and the browser gives correct keyboard handling and
 * screen-reader semantics for free. On a 238-family file that is the
 * difference between a screen that opens instantly and one that thinks about
 * it first.
 */
export function FamilyList({ families }: FamilyListProps) {
  if (families.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-muted">
            No families were found. Nothing in this sheet had a family number in the
            <span className="font-medium text-fg"> U </span>
            column.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-fg">Families</span>
          <span className="text-sm text-muted">
            {families.length} — tap one to see its people and travel
          </span>
        </div>
      </CardHeader>
      <CardBody className="flex flex-col divide-y divide-border p-0">
        {families.map((family) => (
          <FamilyRow key={`${family.familyIndex}-${family.sourceRowIndex}`} family={family} />
        ))}
      </CardBody>
    </Card>
  )
}

function FamilyRow({ family }: { family: ParsedFamily }) {
  const status = STATUS_META[family.rsvpStatus]
  const warningCount = family.warnings.filter((w) => w.severity !== 'info').length

  return (
    <details
      className="group"
      // Keeps a 238-row list cheap to lay out on a low-end Android: the
      // browser skips rendering work for families scrolled out of view.
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 76px' }}
    >
      <summary className="tap flex min-h-[3.25rem] cursor-pointer list-none items-center gap-3 px-4 py-3 marker:hidden hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="shrink-0 text-xs font-semibold tabular-nums text-subtle">
              #{family.familyNumber}
            </span>
            <span className="truncate font-medium text-fg">
              {family.headName ?? <span className="text-danger">No name on the sheet</span>}
            </span>
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
            <span>
              {family.memberCount} {family.memberCount === 1 ? 'person' : 'people'}
            </span>
            <span aria-hidden>·</span>
            <span className={family.primaryMobile ? '' : 'font-medium text-warning'}>
              {family.primaryMobile ?? 'no phone number'}
            </span>
            {family.place ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{family.place}</span>
              </>
            ) : null}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1.5">
          {warningCount > 0 ? (
            <Badge tone="warning">
              {warningCount}
              <span className="sr-only"> warnings</span>
              <span aria-hidden>!</span>
            </Badge>
          ) : null}
          <Badge tone={status.tone}>{status.label}</Badge>
          <ChevronDownIcon
            className="h-4 w-4 text-subtle transition-transform group-open:rotate-180"
            aria-hidden
          />
        </span>
      </summary>

      <div className="flex flex-col gap-3 border-t border-border bg-surface-2 px-4 py-3">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
          <Detail label="Sheet rows" value={describeRows(family.sheetRowNumbers)} />
          <Detail
            label="Pax on the sheet"
            value={
              family.expectedPax === null
                ? 'not given'
                : `${family.expectedPax}${
                    family.expectedPax === family.memberCount
                      ? ''
                      : ` (${family.memberCount} name${family.memberCount === 1 ? '' : 's'} listed)`
                  }`
            }
          />
          <Detail label="Place" value={family.place ?? 'not given'} />
          <Detail
            label="Phone"
            value={family.primaryMobile ?? family.primaryMobileRaw ?? 'not given'}
            tone={family.primaryMobile ? undefined : 'warning'}
          />
          {family.extras.room || family.extras.bed ? (
            <Detail
              label="Room / bed"
              value={[family.extras.room, family.extras.bed].filter(Boolean).join(' / ')}
            />
          ) : null}
          {family.remark ? (
            <div className="col-span-2">
              <dt className="text-xs font-medium text-subtle">Remark</dt>
              <dd className="text-sm text-fg">{family.remark}</dd>
            </div>
          ) : null}
        </dl>

        <div className="grid gap-2 sm:grid-cols-2">
          <LegCard title="Arrival" leg={family.arrival} />
          <LegCard title="Departure" leg={family.departure} />
        </div>

        <div>
          <p className="text-xs font-medium text-subtle">
            People ({family.members.length})
          </p>
          <ul className="mt-1 flex flex-col gap-1">
            {family.members.map((m) => (
              <li
                key={`${m.sourceRowIndex}-${m.fullName}`}
                className="flex items-baseline justify-between gap-2 text-sm"
              >
                <span className="truncate text-fg">
                  {m.fullName}
                  {m.isHead ? <span className="ml-1 text-xs text-subtle">(head)</span> : null}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-subtle">
                  row {m.sourceRowIndex}
                </span>
              </li>
            ))}
            {family.members.length === 0 ? (
              <li className="text-sm text-danger">
                Nobody. This family has no usable name on any of its rows.
              </li>
            ) : null}
          </ul>
        </div>

        {family.warnings.length > 0 ? (
          <ul className="flex flex-col gap-1 border-t border-border pt-2">
            {family.warnings.map((w, i) => (
              <li
                key={`${w.code}-${w.sheetRowNumber}-${i}`}
                className={`text-xs ${w.severity === 'info' ? 'text-subtle' : 'text-warning'}`}
              >
                <span className="font-medium">
                  Row {w.sheetRowNumber} · {w.field}
                </span>{' '}
                {w.rawValue ? <span className="text-muted">“{w.rawValue}” — </span> : null}
                {w.action}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </details>
  )
}

function LegCard({ title, leg }: { title: string; leg: ParsedTravelLeg }) {
  if (!leg.hasAnyValue) {
    return (
      <div className="rounded-xl border border-border bg-surface px-3 py-2">
        <p className="text-xs font-medium text-subtle">{title}</p>
        <p className="text-sm text-muted">Nothing on the sheet.</p>
      </div>
    )
  }

  // A date the parser could not resolve is shown as the raw cell, marked as
  // raw. Never silently blank: the operator has to be able to see that "4TH"
  // was in the sheet and did not become a date.
  const date = leg.travelDate
    ? formatIsoForHumans(leg.travelDate)
    : leg.travelDateRaw
      ? `“${leg.travelDateRaw}” — not resolved`
      : 'not given'

  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2">
      <p className="text-xs font-medium text-subtle">{title}</p>
      <p className={`text-sm ${leg.travelDate ? 'text-fg' : 'text-warning'}`}>{date}</p>
      <p className="text-sm text-muted">
        {[
          leg.travelTime ?? (leg.travelTimeRaw ? `“${leg.travelTimeRaw}”` : null),
          leg.mode ?? (leg.modeRaw ? `“${leg.modeRaw}”` : null),
          leg.reference,
          leg.point,
        ]
          .filter(Boolean)
          .join(' · ') || '—'}
      </p>
    </div>
  )
}

function Detail({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'warning'
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-subtle">{label}</dt>
      <dd className={`truncate text-sm ${tone === 'warning' ? 'text-warning' : 'text-fg'}`}>
        {value}
      </dd>
    </div>
  )
}

/** "12–15" for a run, "12, 14, 15" otherwise. Keeps long families readable. */
function describeRows(rows: number[]): string {
  if (rows.length === 0) return '—'
  if (rows.length === 1) return String(rows[0])

  const isRun = rows.every((n, i) => i === 0 || n === rows[i - 1] + 1)
  return isRun ? `${rows[0]}–${rows[rows.length - 1]}` : rows.join(', ')
}

export default FamilyList
