'use client'

import { Badge, type BadgeTone } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import type { PreviewResult, RowOutcomeStatus } from '@/lib/actions/import'
import type { BuiltRow } from '@/lib/import/rows'

export interface PreviewStepProps {
  builtRows: BuiltRow[]
  preview: PreviewResult
}

const STATUS_META: Record<RowOutcomeStatus, { label: string; tone: BadgeTone }> = {
  new: { label: 'New', tone: 'success' },
  update: { label: 'Will update', tone: 'info' },
  unchanged: { label: 'Unchanged', tone: 'neutral' },
  duplicate: { label: 'Duplicate in file', tone: 'warning' },
  blocked: { label: 'Cannot import', tone: 'danger' },
}

// Cannot-import first, then what a reviewer most wants to check before
// confirming, then the two quiet outcomes last.
const GROUP_ORDER: RowOutcomeStatus[] = ['blocked', 'new', 'update', 'duplicate', 'unchanged']

/** Step 3: read-only classification against the live database. Nothing is written yet. */
export function PreviewStep({ builtRows, preview }: PreviewStepProps) {
  const byRowNumber = new Map(builtRows.map((r) => [r.rowNumber, r]))

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {GROUP_ORDER.map((status) => (
          <div key={status} className="rounded-xl border border-border bg-surface p-3 text-center">
            <div className="text-2xl font-bold tabular-nums text-fg">{preview.counts[status]}</div>
            <div className="mt-0.5 text-xs font-medium text-muted">{STATUS_META[status].label}</div>
          </div>
        ))}
      </div>

      {GROUP_ORDER.map((status) => {
        const rows = preview.rows.filter((r) => r.status === status)
        if (rows.length === 0) return null

        return (
          <Card key={status}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_META[status].tone}>{STATUS_META[status].label}</Badge>
                <span className="text-sm text-muted">
                  {rows.length} row{rows.length === 1 ? '' : 's'}
                </span>
              </div>
            </CardHeader>
            <CardBody className="flex flex-col divide-y divide-border p-0">
              {rows.map((outcome) => {
                const built = byRowNumber.get(outcome.rowNumber)
                return (
                  <div key={outcome.rowNumber} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-fg">
                        {built?.fields.headName ?? `Row ${outcome.rowNumber}`}
                      </span>
                      <span className="shrink-0 text-xs text-subtle">
                        Sheet row {outcome.rowNumber}
                      </span>
                    </div>
                    {outcome.reason ? <p className="mt-0.5 text-sm text-muted">{outcome.reason}</p> : null}
                    {built?.warnings.map((w, i) => (
                      <p key={i} className="mt-0.5 text-sm text-warning">
                        {w}
                      </p>
                    ))}
                  </div>
                )
              })}
            </CardBody>
          </Card>
        )
      })}
    </div>
  )
}

export default PreviewStep
