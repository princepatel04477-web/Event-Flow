'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { LinkButton } from '@/components/ui/LinkButton'
import { ShieldAlertIcon, DownloadIcon } from '@/components/icons'
import { readLedger, type LedgerRow, type LedgerFilter } from '@/lib/actions/departures'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
  eventCode: string
  eventName: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; data: { rows: LedgerRow[]; summary: { total: number; balanced: number; unbalanced: number } }; filter: LedgerFilter }
  | { stage: 'error'; message: string }

const STATE_META: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  balanced: { label: 'Balanced', tone: 'success' },
  departure_missing: { label: 'Departure missing', tone: 'danger' },
  no_arrival: { label: 'No arrival', tone: 'warning' },
}

export function LedgerClient({ eventId, eventCode, eventName }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [filter, setFilter] = useState<LedgerFilter>('all')

  const load = useCallback(async (f: LedgerFilter) => {
    setPhase({ stage: 'loading' })
    try {
      const data = await readLedger(eventId, f)
      setPhase({ stage: 'ready', data, filter: f })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load the ledger.' })
    }
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load('all') }, [load])

  const handleFilter = (f: LedgerFilter) => {
    setFilter(f)
    load(f)
  }

  const handleExport = () => {
    if (phase.stage !== 'ready') return
    const ws = XLSX.utils.json_to_sheet(
      phase.data.rows.map((r) => ({
        Family: r.headName,
        PAX: r.pax,
        'Arrival legs': r.arrivalLegs,
        'Departure legs': r.departureLegs,
        Status: STATE_META[r.state]?.label ?? r.state,
      })),
    )
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Travel Ledger')
    XLSX.writeFile(wb, `${eventCode}_travel_ledger.xlsx`)
  }

  if (phase.stage === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (phase.stage === 'error') {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Could not load ledger"
        description={phase.message}
        action={<Button onClick={() => load(filter)}>Retry</Button>}
      />
    )
  }

  const { data } = phase

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Travel ledger</h2>
        <p className="mt-0.5 text-sm text-muted">{eventName}</p>
      </div>

      {/* Big headline */}
      <Card>
        <CardBody className="text-center">
          <p className="text-3xl font-bold tabular-nums text-fg">
            {data.summary.balanced}
            <span className="text-lg font-normal text-muted"> of </span>
            {data.summary.total}
          </p>
          <p className="mt-1 text-sm text-muted">
            families balanced
            {data.summary.unbalanced > 0 && (
              <span className="ml-2 font-semibold text-danger">
                · {data.summary.unbalanced} still here
              </span>
            )}
          </p>
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex gap-2">
        {([
          ['all', 'All'],
          ['departure_missing', 'Missing departure'],
          ['no_arrival', 'No arrival'],
        ] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => handleFilter(value)}
            className={cn(
              'tap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
              filter === value
                ? 'bg-brand text-brand-fg'
                : 'bg-surface-2 text-muted hover:text-fg',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted">No families match this filter.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {data.rows.map((r) => {
            const meta = STATE_META[r.state] ?? STATE_META.no_arrival
            return (
              <LinkButton
                key={r.groupId}
                href={`/${eventCode}/departures`}
                variant="secondary"
                fullWidth
                className="justify-between"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate font-medium text-fg">{r.headName}</span>
                  <Badge tone="neutral" size="sm">{r.pax}</Badge>
                </div>
                <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
              </LinkButton>
            )
          })}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          fullWidth
          variant="secondary"
          leadingIcon={<DownloadIcon className="h-5 w-5" />}
          onClick={handleExport}
        >
          Export to Excel
        </Button>
      </div>
    </div>
  )
}
