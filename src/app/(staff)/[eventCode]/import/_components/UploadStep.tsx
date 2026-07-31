'use client'

import { useRef, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { UploadIcon } from '@/components/icons'
import { parseWorkbook, type ParsedSheet } from '@/lib/import/parse'

export interface UploadStepProps {
  onParsed: (fileName: string, parsed: ParsedSheet) => void
}

/** Step 1: pick a file and parse it locally. Nothing leaves the browser here. */
export function UploadStep({ onParsed }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setBusy(true)
    setError(null)
    try {
      const parsed = await parseWorkbook(file)
      if (parsed.rows.length === 0) {
        setError(`"${parsed.sheetName}" has a header row but no data rows.`)
        return
      }
      onParsed(file.name, parsed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-tint-neutral text-muted">
          <UploadIcon className="h-7 w-7" />
        </span>

        <div>
          <p className="text-base font-semibold text-fg">Upload the calling list</p>
          <p className="mt-1 text-sm text-muted">
            .xlsx or .csv. It stays on this device until you review and confirm the preview.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={busy}
        />
        <Button type="button" size="lg" loading={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Reading file…' : 'Choose file'}
        </Button>

        {error ? (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        ) : null}
      </CardBody>
    </Card>
  )
}

export default UploadStep
