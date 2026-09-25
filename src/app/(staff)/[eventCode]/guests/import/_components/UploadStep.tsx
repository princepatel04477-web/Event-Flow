'use client'

import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'

import { UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { buildExportTemplateWorkbook } from '@/lib/export/template'
import { parseImportFile, type ImportOutcome } from '@/lib/import/knownSheet'
import { KNOWN_SHEET_NAME } from '@/lib/import/parse'

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
  function handleTemplate() {
    XLSX.writeFile(buildExportTemplateWorkbook(), 'EventFlow_guest_export_template.xlsx')
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
          <p className="text-base font-semibold text-fg">Choose the calling list</p>
          <p className="mt-1 text-sm text-muted">
            .xlsx or .xls. The app&apos;s own export is read in full, and so is a full
            CALLING MASTER LIST (the{' '}
            <span className="font-medium text-fg">{KNOWN_SHEET_NAME}</span> tab) — travel, rooms,
            guest counts. The right tab is found by its headers, so neither has to be renamed. A
            plain list with just <span className="font-medium text-fg">Name</span> and{' '}
            <span className="font-medium text-fg">Contact</span> columns works too — each row
            becomes one guest to call.
          </p>
          <p className="mt-1 text-sm text-muted">
            The file is read on this phone and is not uploaded anywhere.
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          // Broad accept on purpose: Android's document picker matches MIME
          // types, not bare extensions, and with ".xlsx,.xls" alone it can
          // offer no spreadsheet apps at all. The MIME types cover the
          // realistic set; the parser still rejects anything it can't read.
          accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
          className="sr-only"
          onChange={(e) => handleFiles(e.target.files)}
          disabled={busy}
        />
        <Button type="button" size="lg" loading={busy} onClick={() => inputRef.current?.click()}>
          {busy ? 'Reading file…' : 'Choose file'}
        </Button>
        {/* The template is the cheapest fix for the most expensive failure.
            Column resolution is EXACT-MATCH ONLY — deliberately, because a
            fuzzily-matched header gives every family someone else's phone
            number and nobody can see it happened. This button hands over the
            export format itself, not a copy of it: the workbook is built from
            the exporter's own sheet definitions, so a file filled in against
            these headers re-imports cleanly. */}
        <Button type="button" variant="secondary" size="lg" onClick={handleTemplate}>
          Download template
        </Button>
        <p className="-mt-2 text-xs leading-relaxed text-subtle">
          The same sheets the app exports, headers only. Fill it in and it imports
          back unchanged.
        </p>
        {/* The legacy calling-list template, kept because its path is a frozen
            identifier and it is still a valid starting point. */}
        <a
          href="/nuvent-guest-list-template.xlsx"
          download
          className="text-sm font-medium text-brand underline underline-offset-2"
        >
          Download the blank calling-list template
        </a>
      </CardBody>
    </Card>
  )
}

export default UploadStep