import type { ReactNode } from 'react'

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
 * One guest, read-only.
 *
 * This is the client's screen, and it is the only place in the app rendered
 * on warm paper rather than the night ground (see `data-theme='client'` in
 * the event layout). The tone is a printed itinerary, not an ops console:
 * the name is set in the display serif, the facts sit in a labelled grid
 * like a ticket, and there is not one control on it. No writes, no forms —
 * a client has no write access to anything, and staff who land here have
 * their own screens for that.
 *
 * TRAP: in `client_guest_profiles` only `guest_name`, `hotel_name` and
 * `room_number` are per-guest. Pax, side, group type, both travel legs and both
 * delivery flags all come from `guest_groups` and are therefore identical
 * across every sibling card. The copy is worded to admit that ("Family of 6",
 * not a bare "6") so a repeated number cannot read as a per-person count.
 */
export function GuestCard({ row, headingLevel, showFamilyHead = false }: GuestCardProps) {
  const Heading = headingLevel
  const name = row.guest_name?.trim() || 'Name not recorded'
  const head = row.family_head?.trim() || null

  const side = sideLabel(row.side)
  const groupType = groupTypeLabel(row.group_type)
  const pax = typeof row.pax === 'number' ? row.pax : null

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

  const flags = [
    { label: 'Hamper', delivered: row.hamper_delivered },
    // Three states, not two. The view emits
    // `case when needs_return_gift then coalesce(delivered, false) end`, so
    // NULL means "this family is not getting a return gift" — drop the row
    // entirely rather than show a "not delivered" flag against a family that
    // is owed nothing.
    { label: 'Return gift', delivered: row.return_gift_delivered },
  ].filter((f) => f.delivered !== null)

  return (
    <article className="list-fade overflow-hidden rounded-2xl border border-rule-strong bg-surface shadow-[0_2px_10px_-6px_rgba(27,36,38,0.28)]">
      <header className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3.5">
        <div className="min-w-0">
          <Heading className="font-display text-2xl leading-tight font-medium text-pretty text-ink">
            {name}
          </Heading>
          {showFamilyHead && head && head !== name ? (
            <p className="mt-1 text-sm text-muted">Family of {head}</p>
          ) : null}
          {side || groupType ? (
            <p className="mt-1 text-sm text-muted">
              {[groupType, side].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </div>

        {pax !== null ? (
          <div className="shrink-0 text-right">
            <div className="figure text-xl leading-none font-medium text-ink">{pax}</div>
            <div className="eyebrow mt-1">Travelling</div>
          </div>
        ) : null}
      </header>

      {/* Two columns, ticket-style. Four facts is exactly what fits on a
          390px screen without either column wrapping. */}
      <dl className="grid grid-cols-2 gap-x-3 gap-y-3.5 px-4 py-3.5">
        <Detail label="Arrival">
          <LegLines leg={arrival} />
        </Detail>
        <Detail label="Departure">
          <LegLines leg={departure} />
        </Detail>
        <Detail label="Stay" wide>
          <span className={row.room_number ? 'text-ink' : 'text-muted'}>
            {describeRoom(row)}
          </span>
        </Detail>
      </dl>

      {flags.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-brand-tint px-4 py-3">
          {flags.map((f) => (
            <span key={f.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className={`flex h-4 w-4 items-center justify-center rounded-full text-[0.5rem] font-semibold text-surface ${
                  f.delivered ? 'bg-ledger-green' : 'bg-brand'
                }`}
              >
                {f.delivered ? '✓' : '·'}
              </span>
              <span className="text-sm text-ink">
                {f.label} {f.delivered ? 'delivered' : 'on its way'}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </article>
  )
}

function Detail({
  label,
  children,
  wide = false,
}: {
  label: string
  children: ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'col-span-2 min-w-0' : 'min-w-0'}>
      <dt className="eyebrow text-brand">{label}</dt>
      <dd className="mt-1.5 text-base leading-snug">{children}</dd>
    </div>
  )
}

function LegLines({ leg }: { leg: ReturnType<typeof describeLeg> }) {
  return (
    <>
      <span className={leg.known ? 'block font-medium text-ink' : 'block text-muted'}>
        {leg.when}
      </span>
      {leg.detail ? (
        <span className="mt-0.5 block text-sm text-muted">{leg.detail}</span>
      ) : null}
    </>
  )
}

export default GuestCard
