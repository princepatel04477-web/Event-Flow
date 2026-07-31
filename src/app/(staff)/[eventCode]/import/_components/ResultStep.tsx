'use client'

import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { CheckCircleIcon, ShieldAlertIcon } from '@/components/icons'
import type { CommitResult } from '@/lib/actions/import'

export interface ResultStepProps {
  result: CommitResult
}

/** Step 4: what actually got written. */
export function ResultStep({ result }: ResultStepProps) {
  const errorRows = result.rows.filter((r) => r.status === 'error')
  const clean = result.failed === 0 && !result.partial

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
          <span
            className={
              clean
                ? 'flex h-14 w-14 items-center justify-center rounded-full bg-tint-success text-success'
                : 'flex h-14 w-14 items-center justify-center rounded-full bg-tint-warning text-warning'
            }
            aria-hidden
          >
            {clean ? <CheckCircleIcon className="h-7 w-7" /> : <ShieldAlertIcon className="h-7 w-7" />}
          </span>
          <p className="text-lg font-semibold text-fg">
            {clean ? 'Import complete' : 'Import finished with problems'}
          </p>
          <p className="text-sm text-muted">
            {result.totalRows} row{result.totalRows === 1 ? '' : 's'} processed from the file.
          </p>
          {result.partial && result.error ? (
            <p className="max-w-sm text-sm font-medium text-warning">
              {result.error} The rows listed below were still written — nothing is rolled back.
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* "Skipped" and "Failed" are separate on purpose: skipped means
          "deliberately not written" (already up to date, duplicate in the
          file), failed means "was meant to be written and was not". */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Inserted" value={result.inserted} tone="success" />
        <Stat label="Updated" value={result.updated} tone="info" />
        <Stat label="Skipped" value={result.skipped} tone="neutral" />
        <Stat label="Failed" value={result.failed} tone={result.failed > 0 ? 'danger' : 'neutral'} />
      </div>

      {errorRows.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Badge tone="danger">Failed</Badge>
              <span className="text-sm text-muted">
                {errorRows.length} row{errorRows.length === 1 ? '' : 's'} — the rest still imported
              </span>
            </div>
          </CardHeader>
          <CardBody className="flex flex-col divide-y divide-border p-0">
            {errorRows.map((row) => (
              <div key={row.rowNumber} className="flex items-start gap-2 px-4 py-3">
                <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
                <div>
                  <p className="text-sm font-medium text-fg">Sheet row {row.rowNumber}</p>
                  <p className="text-sm text-danger">{row.error}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string
  value: number
  tone: 'success' | 'info' | 'neutral' | 'danger'
}) {
  const toneClass =
    tone === 'success'
      ? 'text-success'
      : tone === 'info'
        ? 'text-info'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-fg'

  return (
    <div className="rounded-xl border border-border bg-surface p-3 text-center">
      <div className={`text-2xl font-bold tabular-nums ${toneClass}`}>{value}</div>
      <div className="mt-0.5 text-xs font-medium text-muted">{label}</div>
    </div>
  )
}

export default ResultStep
