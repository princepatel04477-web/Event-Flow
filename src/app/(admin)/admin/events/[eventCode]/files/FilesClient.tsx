'use client'

import { useState } from 'react'

import { Button } from '@/components/ui/Button'
import {
  generateExport,
  listExports,
  signExport,
  type ExportFileRow,
  type ExportFormat,
} from '@/lib/actions/files'
import { EXPORT_KINDS, type ExportKind } from '@/lib/files/kinds'

/**
 * The Files area (A11).
 *
 * Two halves: a generate control for every export, and the history of what has
 * already been produced. Generating opens the one-hour signed URL immediately —
 * the file has just been made, so making the admin hunt for it in the table a
 * second time would be two actions for one intention.
 */
export function FilesClient({
  eventId,
  initial,
}: {
  eventId: string
  initial: ExportFileRow[]
}) {
  const [rows, setRows] = useState<ExportFileRow[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function generate(kind: ExportKind, format: ExportFormat) {
    setError(null)
    setBusy(`${kind}:${format}`)
    try {
      const result = await generateExport(eventId, kind, format)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.url) window.open(result.url, '_blank', 'noopener')
      setRows(await listExports(eventId))
    } finally {
      setBusy(null)
    }
  }

  async function download(path: string) {
    setError(null)
    const url = await signExport(path)
    if (url) window.open(url, '_blank', 'noopener')
    else setError('That file could not be signed — try generating it again.')
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">Generate</h2>
        <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
          {EXPORT_KINDS.map((kind) => (
            <li
              key={kind.id}
              className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
            >
              <span className="min-w-0 truncate text-base text-ink">{kind.label}</span>
              <span className="flex shrink-0 gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void generate(kind.id, 'xlsx')}
                >
                  {busy === `${kind.id}:xlsx` ? '…' : '.xlsx'}
                </Button>
                {/* CSV carries one sheet; offering it for the multi-sheet backup
                    would silently write only the first tab. */}
                {kind.sheets.length === 1 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => void generate(kind.id, 'csv')}
                  >
                    {busy === `${kind.id}:csv` ? '…' : 'CSV'}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="eyebrow">History</h2>
        {rows.length === 0 ? (
          <p className="rounded-xl border border-rule-strong bg-surface px-3.5 py-3 text-sm text-muted">
            Nothing generated yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-2xl border border-rule-strong bg-surface">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center justify-between gap-3 border-b border-rule px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-base text-ink">
                    {row.kind} · {row.format.toUpperCase()}
                  </span>
                  <span className="block text-xs text-muted">
                    {formatBytes(row.bytes)} · {row.createdAt.slice(0, 16).replace('T', ' ')}
                  </span>
                </span>
                <Button variant="ghost" size="sm" onClick={() => void download(row.path)}>
                  Download
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">Download links are signed and expire after one hour.</p>
      </section>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default FilesClient
