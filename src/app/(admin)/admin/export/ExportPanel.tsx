'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { UploadIcon } from '@/components/icons'
import {
  SHEET_NAMES,
  buildWorkbook,
  exportFilename,
  type ExportData,
  type SheetName,
} from '@/lib/export/workbook'

export interface ExportPanelProps {
  eventCode: string
  data: ExportData
}

/**
 * Generates the workbook in the browser and hands it to the download.
 *
 * Client-side on purpose: the rows are already on this page, so writing the
 * file here saves a round trip, keeps guest data out of a server response
 * that would only be echoed back, and means a flaky venue connection cannot
 * fail halfway through producing a file the desk is waiting on.
 */
export function ExportPanel({ eventCode, data }: ExportPanelProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function download(label: string, only?: SheetName) {
    setError(null)
    setBusy(label)
    try {
      const book = buildWorkbook(data, only)
      XLSX.writeFile(book, exportFilename(eventCode, label, new Date()), {
        bookType: 'xlsx',
        // Compression keeps the file small enough to send over WhatsApp,
        // which is how these actually reach the logistics desk.
        compression: true,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not build the workbook.')
    } finally {
      setBusy(null)
    }
  }

  const counts = {
    Guests: data.guests.length,
    Families: data.groups.length,
    Arrivals: data.legs.filter((l) => l.direction === 'arrival').length,
    Departures: data.legs.filter((l) => l.direction === 'departure').length,
  } satisfies Record<SheetName, number>

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">Full workbook</p>
            <p className="text-xs text-muted">All four sheets in one file.</p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <dl className="grid grid-cols-2 gap-2 text-sm">
            {SHEET_NAMES.map((name) => (
              <div key={name} className="flex justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2">
                <dt className="text-muted">{name}</dt>
                <dd className="font-semibold text-fg">{counts[name]}</dd>
              </div>
            ))}
          </dl>

          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}

          <Button
            size="lg"
            fullWidth
            leadingIcon={<UploadIcon className="h-5 w-5" />}
            loading={busy === 'full'}
            disabled={busy !== null}
            onClick={() => download('full')}
          >
            Download workbook
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <p className="font-semibold text-fg">One sheet at a time</p>
            <p className="text-xs text-muted">
              For handing a single list to one desk without sending everything else with it.
            </p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-2">
          {SHEET_NAMES.map((name) => (
            <Button
              key={name}
              variant="secondary"
              fullWidth
              loading={busy === name}
              disabled={busy !== null}
              onClick={() => download(name, name)}
            >
              {name} ({counts[name]})
            </Button>
          ))}
        </CardBody>
      </Card>

      <p className="text-xs text-subtle">
        Every row carries its <code>group_id</code> (and <code>guest_id</code> on the Guests
        sheet) in hidden columns. Leave those columns alone — they are what lets an edited sheet
        come back in without creating duplicate families.
      </p>
    </div>
  )
}

export default ExportPanel
