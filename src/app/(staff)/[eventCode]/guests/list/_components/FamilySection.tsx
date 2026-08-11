import { GuestCard } from './GuestCard'
import type { GuestFamily } from './format'

export interface FamilySectionProps {
  family: GuestFamily
  /** Used to mint a stable, DOM-safe id for `aria-labelledby`. */
  index: number
}

/**
 * One family head and their guests.
 *
 * A family of one gets no heading — the guest's own card is the heading, and a
 * banner repeating the same name above a single card is noise on a 360px
 * screen. Where a heading does appear, the cards drop to <h4> so the document
 * outline stays contiguous.
 */
export function FamilySection({ family, index }: FamilySectionProps) {
  const grouped = family.guests.length > 1
  const headingId = `family-${index}`

  if (!grouped) {
    const row = family.guests[0]
    return (
      <section>
        <GuestCard row={row} headingLevel="h3" showFamilyHead />
      </section>
    )
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h3 id={headingId} className="text-base font-semibold text-fg text-pretty">
          {family.head ?? 'Family not recorded'}
        </h3>
        <span className="shrink-0 text-sm text-muted">{family.guests.length} guests</span>
      </div>

      <div className="flex flex-col gap-2">
        {family.guests.map((row, i) => (
          <GuestCard key={row.guest_id ?? `${headingId}-${i}`} row={row} headingLevel="h4" />
        ))}
      </div>
    </section>
  )
}

export default FamilySection
