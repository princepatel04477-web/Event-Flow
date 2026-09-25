'use client'

import Link from 'next/link'
import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Progress } from '@/components/ui/Progress'
import { Row, type RowTone } from '@/components/ui/Row'
import { Spinner } from '@/components/ui/Spinner'
import { ShieldAlertIcon, DownloadIcon } from '@/components/icons'
import { readLedger, type LedgerRow, type LedgerFilter } from '@/lib/actions/departures'

interface Props {
  eventId: string
  eventCode: string
  eventName: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; data: { rows: LedgerRow[]; summary: { total: number; balanced: number; unbalanced: number } }; filter: LedgerFilter }
  | { stage: 'error'; message: string }

const STATE_META: Record<string, { label: string; tone: RowTone }> = {
  balanced: { label: 'Balanced', tone: 'done' },
  departure_missing: { label: 'Departure missing', tone: 'problem' },
  no_arrival: { label: 'No arrival', tone: 'waiting' },
}

const FILTERS: { value: LedgerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'departure_missing', label: 'Missing departure' },
  { value: 'no_arrival', label: 'No arrival' },
]

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
    XLSX.utils.book_append_sheet(wb, ws, 'Logistics Ledger')
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
      <AdminPageTitle context={eventName}>Logistics ledger</AdminPageTitle>

      {/* The headline is a bar now, not a three-line paragraph: the same
          balanced/total figures, read at a glance. */}
      <Card>
        <CardBody className="flex flex-col gap-2">
          <Progress
            label="Families balanced"
            done={data.summary.balanced}
            total={data.summary.total}
            tone="neutral"
          />
          {data.summary.unbalanced > 0 ? (
            <p className="text-sm font-medium text-ledger-amber">
              <span className="figure">{data.summary.unbalanced}</span> still here
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map(({ value, label }) => (
          <Chip
            key={value}
            selected={filter === value}
            onClick={() => handleFilter(value)}
          >
            {label}
          </Chip>
        ))}
      </div>

      {data.rows.length === 0 ? (
        <p className="text-sm text-muted">No families match this filter.</p>
      ) : (
        <Card>
          <ul>
            {data.rows.map((r) => {
              const meta = STATE_META[r.state] ?? STATE_META.no_arrival
              return (
                // The divider lives on the <li>, not on `Row`: `Row` carries
                // `border-b last:border-b-0`, and nested in an anchor inside an
                // <li> it is always its parent's only child, so its own border
                // is always suppressed.
                <li key={r.groupId} className="border-b border-rule last:border-b-0">
                  <Link href={`/${eventCode}/logistics/departures`} className="tap block">
                    {/* No trailing chevron: the status word here is
                        "Departure missing", and at 360px a chevron costs the
                        family name ~30px it does not have. The whole row is
                        the link either way. */}
                    <Row
                      heading={r.headName}
                      meta={`${r.pax} guest${r.pax === 1 ? '' : 's'}`}
                      status={meta.label}
                      tone={meta.tone}
                    />
                  </Link>
                </li>
              )
            })}
          </ul>
        </Card>
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

export default LedgerClient
