'use client'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import { ArrowDownCircleIcon, ArrowUpCircleIcon, CarIcon } from '@/components/icons'
import type { TodayLeg } from '@/lib/actions/dashboard'

interface Props {
  arrivals: TodayLeg[]
  departures: TodayLeg[]
  date: string
  eventCode: string
}

function formatTime(t: string | null): string {
  if (!t) return '—'
  return t.slice(0, 5)
}

function LegRow({ leg, eventCode }: { leg: TodayLeg; eventCode: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2">
      <span className="shrink-0 w-12 text-sm font-mono text-muted">
        {formatTime(leg.travelTime)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{leg.headName}</p>
        <p className="text-xs text-muted">
          {leg.mode ?? '—'}
          {leg.reference ? ` · ${leg.reference}` : ''}
          {leg.point ? ` · ${leg.point}` : ''}
        </p>
      </div>
      <Badge tone="neutral" size="sm">{leg.totalPax}</Badge>
      {leg.hasVehicle ? (
        <CarIcon className="h-4 w-4 shrink-0 text-success" aria-label="Vehicle assigned" />
      ) : (
        <CarIcon className="h-4 w-4 shrink-0 text-muted" aria-label="No vehicle" />
      )}
    </div>
  )
}

export function TodayPanel({ arrivals, departures, date, eventCode }: Props) {
  const dateLabel = date === new Date().toISOString().slice(0, 10) ? 'Today' : date

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">Today&rsquo;s movements · {dateLabel}</h2>

      {arrivals.length === 0 && departures.length === 0 ? (
        <p className="text-sm text-muted">Nothing scheduled for {dateLabel}.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {arrivals.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <ArrowDownCircleIcon className="h-4 w-4 text-info" />
                Arrivals ({arrivals.length})
              </h3>
              <div className="flex flex-col gap-1">
                {arrivals.map((a) => (
                  <LegRow key={a.legId} leg={a} eventCode={eventCode} />
                ))}
              </div>
            </div>
          )}

          {departures.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
                <ArrowUpCircleIcon className="h-4 w-4 text-warning" />
                Departures ({departures.length})
              </h3>
              <div className="flex flex-col gap-1">
                {departures.map((d) => (
                  <LegRow key={d.legId} leg={d} eventCode={eventCode} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2">
        <LinkButton fullWidth variant="secondary" href={`/${eventCode}/logistics/fleet`}>
          Fleet
        </LinkButton>
        <LinkButton fullWidth variant="secondary" href={`/${eventCode}/logistics/departures`}>
          Departures
        </LinkButton>
      </div>
    </section>
  )
}
