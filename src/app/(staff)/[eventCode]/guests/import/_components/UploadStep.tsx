'use client'

import { useRef, useState } from 'react'

import { UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { downloadTemplate } from '@/lib/export/download'
import { parseImportFile, type ImportOutcome } from '@/lib/import/knownSheet'

export interface UploadStepProps {
  /** `events.starts_on`. Ordinal dates ("4TH") cannot resolve without it. */
  eventStartsOn: string | null
  /** `events.ends_on`. Nullable in the schema; the parser handles its absence. */
  eventEndsOn: string | null
  /** Called for both a clean parse and a layout mismatch — both are results. */
  onResult: (fileName: string, outcome: ImportOutcome) => void
  /** Called when the file could not be read at all (wrong tab, corrupt file). */
  onError: (message: string) => void
}

/**
 * Pick a file and parse it, entirely in this browser.
 *
 * The workbook is read with SheetJS from an ArrayBuffer and never uploaded.
 * 465 people's names and phone numbers do not need to cross the network for
 * somebody to look at a preview of them, so they do not.
 */
export function UploadStep({ eventStartsOn, eventEndsOn, onResult, onError }: UploadStepProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  /**
   * The blank template IS the export, headers only — built from the same sheet
   * definitions the "Export Excel" button uses (src/lib/export/template.ts).
   * That is deliberate: the download must hand over the exact shape this
   * importer reads, and the only way to guarantee it is to make it the
   * exporter's own output rather than a second header list to keep in sync.
   */
  async function handleTemplate() {
    await downloadTemplate('EventFlow_guest_export_template.xlsx')
  }

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setBusy(true)
    try {
      const outcome = await parseImportFile(file, {
        eventStartsOn,
        eventEndsOn,
      })
      onResult(file.name, outcome)
    } catch (e) {
      // A file that is not a workbook at all carries its own message. Anything
      // shaped like a workbook is now answered with a structured mismatch, not
      // an exception — see parseImportFile.
      onError(e instanceof Error ? e.message : 'Could not read that file.')
    } finally {
      setBusy(false)
      // Clearing the input matters: picking the SAME file twice after fixing a
      // cell fires no change event otherwise, and the screen looks frozen.
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-4 py-10 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-tint-neutral text-muted"
          aria-hidden
        >
          <UploadIcon className="h-7 w-7" />
        </span>

        <div>
          <p className="text-base font-semibold text-fg">Choose the guest list</p>
          <p className="mt-1 text-sm text-muted">
            .xlsx, .xls, or .csv. Upload any guest list — whether it&apos;s a plain list with names and
            numbers, or a detailed master sheet with headcount and cities.
          </p>
          <p className="mt-1 text-sm text-muted">
            Columns are auto-detected, and you can easily map or adjust columns if needed.
            The file is processed on this device and not uploaded to any external server.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={busy}
        />
        <Button type="button" size="lg" loading={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Reading file…' : 'Choose file'}
        </Button>
        <Button type="button" variant="secondary" size="lg" onClick={() => void handleTemplate()}>
          Download template
        </Button>
        <p className="-mt-2 text-xs leading-relaxed text-subtle">
          The same sheets the app exports, headers only. Fill it in and it imports
          back unchanged.
        </p>
        <a
          href="/nuvent-guest-list-template.xlsx"
          download
          className="text-sm font-medium text-brand underline underline-offset-2"
        >
          Download the blank calling-list template
        </a>
        <p className="-mt-2 text-xs leading-relaxed text-subtle">
          Starting from scratch? The template is a plain two-column list — name
          and number — ready to fill.
        </p>
      </CardBody>
    </Card>
  )
}

export default UploadStep