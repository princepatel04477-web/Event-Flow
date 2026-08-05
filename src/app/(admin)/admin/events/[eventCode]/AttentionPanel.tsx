'use client'

import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import { ShieldAlertIcon } from '@/components/icons'
import type { AttentionRow } from '@/lib/actions/dashboard'

interface Props {
  attn: AttentionRow
  eventCode: string
}

interface AlertItem {
  label: string
  count: number
  href: string
  tone: 'danger' | 'warning'
}

export function AttentionPanel({ attn, eventCode }: Props) {
  const items: AlertItem[] = [
    {
      label: 'Confirmed · no room',
      count: attn.confirmedNoRoom,
      href: `/${eventCode}/rooms`,
      tone: 'danger',
    },
    {
      label: 'Arriving today · no vehicle',
      count: attn.arrivalsNoVehicle,
      href: `/${eventCode}/fleet`,
      tone: 'danger',
    },
    {
      label: 'No departure recorded',
      count: attn.noDeparture,
      href: `/${eventCode}/departures`,
      tone: 'warning',
    },
    {
      label: 'Hampers pending',
      count: attn.hampersPending,
      href: `/${eventCode}/logistics`,
      tone: 'warning',
    },
  ]

  const allZero = items.every((i) => i.count === 0)

  if (allZero) return null

  return (
    <section className="flex flex-col gap-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-fg">
        <ShieldAlertIcon className="h-5 w-5 text-warning" />
        Needs attention
      </h2>

      <div className="flex flex-col gap-2">
        {items
          .filter((i) => i.count > 0)
          .map((i) => (
            <LinkButton
              key={i.label}
              href={i.href}
              variant="secondary"
              fullWidth
              className="justify-between"
            >
              <span className="text-sm text-fg">{i.label}</span>
              <span className="shrink-0 rounded-full bg-tint-warning px-2.5 py-0.5 text-sm font-bold tabular-nums text-warning">
                {i.count}
              </span>
            </LinkButton>
          ))}
      </div>
    </section>
  )
}
