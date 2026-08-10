'use client'

import { useCallback, useState } from 'react'

import { DownloadIcon, UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import type { HotelImportContext } from '@/lib/actions/import-hotels'
import { commitHotelImport, readHotelImportContext } from '@/lib/actions/import-hotels'
import { parseHotelWorkbook, type HotelParseResult } from '@/lib/import/hotelSheet'

interface Props {
  eventId: string
  eventCode: string
  context: HotelImportContext
}

/**
 * Hotel import — upload + preview + commit.
 * Reuses the same UI pattern as the guest import: parse in browser, preview
 * before commit, idempotent re-import.
 */
export function HotelImporter({ eventId, eventCode, context: initialContext }: Props) {
  const [phase, setPhase] = useState<'upload' | 'preview' | 'done'>('upload')
  const [parseResult, setParseResult] = useState<HotelParseResult | null>(null)
  const [fileName, setFileName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<{ inserted: number; skipped: number; failed: number } | null>(null)
  const [context, setContext] = useState(initialContext)

  const handleFile = useCallback(async (file: File) => {
    setError(null)
    try {
      const result = await parseHotelWorkbook(file)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setFileName(file.name)
      setParseResult(result)
      setPhase('preview')
      // Refresh context so the "already exist" count is current
      const ctx = await readHotelImportContext(eventId)
      if (ctx.ok) setContext(ctx)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    }
  }, [eventId])

  async function handleCommit() {
    if (!parseResult) return
    setCommitting(true)
    setError(null)

    const result = await commitHotelImport(eventId, fileName, (parseResult as any).rows)

    if (result.ok && result.summary) {
      setCommitResult(result.summary)
      setPhase('done')
    } else {
      setError(result.error ?? 'Import failed.')
    }
    setCommitting(false)
  }

  // ---- Template download --------------------------------------------------
  function downloadTemplate() {
    const headers = 'Hotel Name,Room Number,Room Type,Floor,Capacity (PAX),Notes,Contact Person,Contact Number,Hotel Address'
    const rows = [
      'Grand Plaza,101,Deluxe,1,2,,Ramesh Patel,9876543210,FC Road',
      'Grand Plaza,102,Deluxe,1,2,,,',
      'Grand Plaza,201,Suite,2,4,Wheelchair accessible,,,',
      'The Orchid,101,Twin,1,2,,Sunita Shah,9988776655,MG Road',
    ]
    const csv = [headers, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'hotel-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  // ---- Upload --------------------------------------------------------------
  if (phase === 'upload') {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-tint-neutral text-muted" aria-hidden>
              <UploadIcon className="h-7 w-7" />
            </span>
            <div>
              <p className="text-base font-semibold text-fg">Import hotel data</p>
              <p className="mt-1 text-sm text-muted">
                Upload a CSV or Excel file with hotel names, room numbers, types, and capacity.
                The template has the exact columns expected.
              </p>
              {context.ok ? (
                <p className="mt-1 text-sm text-muted">
                  {context.existingHotels} hotel{context.existingHotels === 1 ? '' : 's'}, {context.existingRooms} room{context.existingRooms === 1 ? '' : 's'} already on file.
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2 w-full max-w-xs">
              <input
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="sr-only"
                id="hotel-file-input"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                  if (e.target) e.target.value = ''
                }}
              />
              <Button type="button" size="lg" fullWidth onClick={() => document.getElementById('hotel-file-input')?.click()}>
                Choose file
              </Button>
              <Button type="button" variant="secondary" size="md" fullWidth onClick={downloadTemplate}>
                Download template
              </Button>
            </div>
          </CardBody>
        </Card>

        {error ? (
          <p className="rounded-xl bg-tint-danger px-4 py-3 text-sm font-medium text-danger">{error}</p>
        ) : null}
      </div>
    )
  }

  // ---- Preview -------------------------------------------------------------
  if (phase === 'preview' && parseResult && parseResult.ok) {
    const result = parseResult
    const { rows, headers } = result

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="text-lg font-semibold text-fg">{fileName}</h3>
          <p className="text-sm text-muted">
            Headers: {headers.filter(Boolean).join(', ')}. {rows.length} row{rows.length === 1 ? '' : 's'}.
          </p>
        </div>

        <Card>
          <CardBody className="flex flex-col gap-3">
            <p className="text-sm font-medium text-fg">
              {rows.length} room{rows.length === 1 ? '' : 's'} will be imported across the
              hotels in this file. Duplicate rows (same hotel + same room number) are
              silently skipped — re-importing the same file adds zero new rooms.
            </p>
            <div className="max-h-80 overflow-y-auto rounded-lg border border-rule">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-surface-2">
                  <tr className="text-left text-xs font-medium text-muted">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Hotel</th>
                    <th className="px-3 py-2">Room</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Capacity</th>
                    <th className="px-3 py-2">Floor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-rule">
                  {rows.map((row: any, i: number) => (
                    <tr key={i} className="text-fg">
                      <td className="px-3 py-1.5 text-subtle">{row.rowNumber}</td>
                      <td className="px-3 py-1.5">{row.hotelName}</td>
                      <td className="px-3 py-1.5">{row.roomNumber}</td>
                      <td className="px-3 py-1.5">{row.roomType ?? '—'}</td>
                      <td className="px-3 py-1.5">{row.capacity ?? '—'}</td>
                      <td className="px-3 py-1.5">{row.floor ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>

        <div className="flex gap-3">
          <Button variant="secondary" fullWidth onClick={() => setPhase('upload')}>
            Cancel
          </Button>
          <Button variant="primary" fullWidth onClick={handleCommit} loading={committing}>
            Confirm import
          </Button>
        </div>

        {error ? (
          <p className="rounded-xl bg-tint-danger px-4 py-3 text-sm font-medium text-danger">{error}</p>
        ) : null}
      </div>
    )
  }

  // ---- Done ----------------------------------------------------------------
  if (phase === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <Card>
          <CardBody className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-tint-success text-success" aria-hidden>
              <DownloadIcon className="h-7 w-7" />
            </span>
            <div>
              <p className="text-base font-semibold text-fg">Import complete</p>
              <p className="mt-1 text-sm text-muted">
                {commitResult?.inserted ?? 0} room{commitResult?.inserted === 1 ? '' : 's'} created,
                {commitResult?.skipped ?? 0} skipped (already existed),
                {commitResult?.failed ?? 0} failed.
              </p>
            </div>
            <div className="flex gap-3 mt-2">
              <Button variant="secondary" onClick={() => setPhase('upload')}>
                Import another file
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    )
  }

  return null
}
