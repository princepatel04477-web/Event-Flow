'use client'

import { useState } from 'react'
import * as XLSX from 'xlsx'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { DownloadIcon } from '@/components/icons'
import { readExportData } from '@/lib/actions/export'
import { buildWorkbook } from '@/lib/export/workbook'
import { buildSheetDefinitions } from '@/lib/export/definitions'

export interface ExportClientProps {
  eventId: string
}

export function ExportClient({ eventId }: ExportClientProps) {
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    if (exporting) return
    setError(null)
    setExporting(true)
    try {
      const result = await readExportData(eventId)
      if (!result.ok) {
        setError(result.message)
        return
      }

      const sheets = buildSheetDefinitions(result.data)
      const wb = buildWorkbook(sheets)

      const eventPart = result.eventName.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_')
      const filename = `Nuvent_${eventPart || 'Event'}_${stamp()}.xlsx`
      XLSX.writeFile(wb, filename)
    } catch {
      setError('Could not build the workbook. Try again in a moment.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="text-base font-semibold text-fg">Excel export</h2>
            <p className="text-sm text-muted">
              Guest master, family heads, room allocation, deliverables and exceptions — for the
              client, the hotel and the transport vendor.
            </p>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            The guest master round-trips: export → edit in Excel → re-import updates families
            instead of duplicating them. Every row carries its stable id in the <code>_id</code>{' '}
            column.
          </p>
          <Button
            size="lg"
            fullWidth
            loading={exporting}
            leadingIcon={<DownloadIcon className="h-5 w-5" />}
            onClick={handleExport}
          >
            Export Excel
          </Button>
          {error ? (
            <p role="alert" className="text-sm font-medium text-danger">
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>
    </div>
  )
}

function stamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

export default ExportClient
