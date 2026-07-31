import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'

import {
  describeLeg,
  describeRoom,
  groupTypeLabel,
  sideLabel,
  type GuestRow,
} from './format'

export interface GuestCardProps {
  row: GuestRow
  /**
   * Heading level for the guest's name. A family with two or more guests owns
   * an <h3>, so its cards sit at <h4>; a lone guest's card is the <h3> itself.
   * Passed in rather than guessed so the outline never skips a level.
   */
  headingLevel: 'h3' | 'h4'
  /** Rendered under the name only when the card is NOT inside a family section. */
  showFamilyHead?: boolean
}

/**
 * One guest, read-only. No writes, no forms — a client has no write access to
 * anything, and staff who land here have their own screens for that.
 *
 * TRAP: in `client_guest_profiles` only `guest_name`, `hotel_name` and
 * `room_number` are per-guest. Pax, side, group type, both travel legs and both
 * delivery flags all come from `guest_groups` and are therefore identical
 * across every sibling card. The copy is worded to admit that ("Family of 6",
 * not a bare "6") so a repeated number cannot read as a per-person count.
 *
 * Everything is composed from `Card` as shipped — no class overrides on the
 * shipped layout, because `cn()` concatenates and cannot resolve a Tailwind
 * conflict.
 */
export function GuestCard({ row, headingLevel, showFamilyHead = false }: GuestCardProps) {
  const Heading = headingLevel
  const name = row.guest_name?.trim() || 'Name not recorded'
  const head = row.family_head?.trim() || null

  const side = sideLabel(row.side)
  const groupType = groupTypeLabel(row.group_type)
  const pax = typeof row.pax === 'number' ? row.pax : null
  const hasChips = Boolean(side || groupType || pax !== null)

  const arrival = describeLeg({
    date: row.arrival_date,
    time: row.arrival_time,
    mode: row.arrival_mode,
    point: row.arrival_point,
  })
  const departure = describeLeg({
    date: row.departure_date,
    time: row.departure_time,
    mode: row.departure_mode,
    point: row.departure_point,
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Heading className="text-base font-semibold text-fg text-pretty">{name}</Heading>

          {showFamilyHead && head && head !== name ? (
            <p className="mt-0.5 text-sm text-muted">Family of {head}</p>
          ) : null}

          {hasChips ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {groupType ? <Badge>{groupType}</Badge> : null}
              {side ? <Badge tone="info">{side}</Badge> : null}
              {pax !== null ? <Badge>Family of {pax}</Badge> : null}
            </div>
          ) : null}
        </CardTitle>
      </CardHeader>

      <CardBody>
        <dl className="flex flex-col gap-3">
          <Detail label="Arrival">
            <LegLines leg={arrival} />
          </Detail>

          <Detail label="Departure">
            <LegLines leg={departure} />
          </Detail>

          <Detail label="Stay">
            <span className={row.room_number ? 'text-fg' : 'text-muted'}>
              {describeRoom(row)}
            </span>
          </Detail>
        </dl>

        <div className="mt-4 flex flex-wrap gap-1.5">
          <HamperBadge delivered={row.hamper_delivered} />
          <ReturnGiftBadge delivered={row.return_gift_delivered} />
        </div>
      </CardBody>
    </Card>
  )
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 text-base leading-snug">{children}</dd>
    </div>
  )
}

function LegLines({ leg }: { leg: ReturnType<typeof describeLeg> }) {
  return (
    <>
      <span className={leg.known ? 'block text-fg' : 'block text-muted'}>{leg.when}</span>
      {leg.detail ? (
        <span className="mt-0.5 block text-sm text-muted">{leg.detail}</span>
      ) : null}
    </>
  )
}

/**
 * `hamper_delivered` is `coalesce(bool_or(...), false)` in the view, so it is
 * genuinely two-state: delivered, or not yet. Not-yet is the ordinary Phase 1
 * state and must not be coloured like a failure.
 */
function HamperBadge({ delivered }: { delivered: boolean | null }) {
  if (delivered) return <Badge tone="success">Hamper delivered</Badge>
  return <Badge>Hamper not delivered yet</Badge>
}

/**
 * Three states, not two. The view emits
 * `case when needs_return_gift then coalesce(delivered, false) end`, so NULL
 * means "this family is not getting a return gift" — render nothing at all
 * rather than a "not delivered" badge that would read as an outstanding task
 * against a family that has none.
 */
function ReturnGiftBadge({ delivered }: { delivered: boolean | null }) {
  if (delivered === null) return null
  if (delivered) return <Badge tone="success">Return gift delivered</Badge>
  return <Badge>Return gift not delivered yet</Badge>
}

export default GuestCard
