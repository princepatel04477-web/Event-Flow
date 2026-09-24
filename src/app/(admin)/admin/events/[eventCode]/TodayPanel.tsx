'use client'

import { LinkButton } from '@/components/ui/LinkButton'
import { ArrowDownCircleIcon, ArrowUpCircleIcon, CarIcon } from '@/components/icons'
import type { TodayLeg } from '@/lib/actions/dashboard'
import { getTodayDateIST } from '@/lib/utils'

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

function LegRow({ leg }: { leg: TodayLeg }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
      <span className="figure w-12 shrink-0 text-sm text-muted">
        {formatTime(leg.travelTime)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{leg.headName}</p>
        <p className="truncate text-xs text-muted">
          {leg.mode ?? '—'}
          {leg.reference ? ` · ${leg.reference}` : ''}
          {leg.point ? ` · ${leg.point}` : ''}
        </p>
      </div>
      <span className="figure shrink-0 text-xs text-muted">{leg.totalPax}</span>
      {leg.hasVehicle ? (
        <CarIcon className="h-4 w-4 shrink-0 text-ledger-green" aria-label="Vehicle assigned" />
      ) : (
        <CarIcon className="h-4 w-4 shrink-0 text-muted" aria-label="No vehicle" />
      )}
    </div>
  )
}

export function TodayPanel({ arrivals, departures, date, eventCode }: Props) {
  const dateLabel = date === getTodayDateIST() ? 'Today' : date

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="eyebrow">Today&rsquo;s movements</h2>
        <span className="figure text-xs text-muted">{dateLabel}</span>
      </div>

      {arrivals.length === 0 && departures.length === 0 ? (
        <p className="text-sm text-muted">Nothing scheduled for {dateLabel}.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {arrivals.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <ArrowDownCircleIcon className="h-4 w-4 text-muted" aria-hidden />
                Arrivals
                <span className="figure font-normal text-muted">({arrivals.length})</span>
              </h3>
              <div className="flex flex-col gap-1">
                {arrivals.map((a) => (
                  <LegRow key={a.legId} leg={a} />
                ))}
              </div>
            </div>
          )}

          {departures.length > 0 && (
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">
                <ArrowUpCircleIcon className="h-4 w-4 text-ledger-amber" aria-hidden />
                Departures
                <span className="figure font-normal text-muted">({departures.length})</span>
              </h3>
              <div className="flex flex-col gap-1">
                {departures.map((d) => (
                  <LegRow key={d.legId} leg={d} />
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

export default TodayPanel
