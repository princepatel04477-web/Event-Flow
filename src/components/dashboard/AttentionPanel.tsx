import Link from 'next/link'

import type { AttentionRow } from '@/lib/actions/dashboard'

interface AttentionPanelProps {
  attn: AttentionRow
  eventCode: string
}

interface AlertItem {
  label: string
  count: number
  href: string
}

/**
 * "Needs eyes on it" — the one block on the board that is allowed to be red.
 *
 * Every row is a live gap in the ledger, and every row is a link to the
 * screen where you close it. Rows at zero are dropped rather than shown
 * greyed: a list of four items where three say "0" trains people to skim
 * past the one that does not.
 *
 * The whole panel disappears when there is nothing wrong. An empty red box
 * saying "all clear" is a red box, and after a day of seeing it nobody
 * reads the colour any more.
 */
export function AttentionPanel({ attn, eventCode }: AttentionPanelProps) {
  const items: AlertItem[] = [
    {
      label: 'Confirmed, no room',
      count: attn.confirmedNoRoom,
      href: `/${eventCode}/hospitality/rooms`,
    },
    {
      label: 'Arriving today, no vehicle',
      count: attn.arrivalsNoVehicle,
      href: `/${eventCode}/logistics/fleet`,
    },
    {
      label: 'Arrived, no departure logged',
      count: attn.noDeparture,
      href: `/${eventCode}/logistics/departures`,
    },
    {
      label: 'Hampers with no proof',
      count: attn.hampersPending,
      href: `/${eventCode}/hospitality/deliveries`,
    },
  ].filter((i) => i.count > 0)

  if (items.length === 0) return null

  return (
    <section
      aria-labelledby="attention-heading"
      className="overflow-hidden rounded-2xl border border-ledger-red/35 bg-red-tint"
    >
      <h2
        id="attention-heading"
        className="flex items-center gap-2 border-b border-ledger-red/25 px-3.5 py-3 font-mono text-xs font-semibold tracking-eyebrow text-ledger-red uppercase"
      >
        <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ledger-red" />
        Needs eyes on it
      </h2>

      <ul>
        {items.map((item) => (
          <li key={item.label} className="border-b border-ledger-red/15 last:border-b-0">
            <Link
              href={item.href}
              className="tap flex min-h-12 items-center justify-between gap-3 px-3.5 py-3 transition-colors duration-press ease-ledger active:bg-ledger-red/10"
            >
              <span className="text-base leading-snug text-ink">{item.label}</span>
              <span className="figure shrink-0 text-lg font-medium text-ledger-red">
                {item.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default AttentionPanel
