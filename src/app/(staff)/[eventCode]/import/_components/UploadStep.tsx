'use client'

import { useRef, useState } from 'react'

import { UploadIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { parseKnownWorkbook, type KnownSheetOutcome } from '@/lib/import/knownSheet'
import { KNOWN_SHEET_NAME } from '@/lib/import/parse'

export interface UploadStepProps {
  /** `events.starts_on`. Ordinal dates ("4TH") cannot resolve without it. */
  eventStartsOn: string | null
  /** `events.ends_on`. Nullable in the schema; the parser handles its absence. */
  eventEndsOn: string | null
  /** Called for both a clean parse and a layout mismatch — both are results. */
  onResult: (fileName: string, outcome: KnownSheetOutcome) => void
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

  async function handleFiles(files: FileList | null) {
    const file = files?.[0]
    if (!file) return

    setBusy(true)
    try {
      const outcome = await parseKnownWorkbook(file, {
        eventStartsOn,
        eventEndsOn,
      })
      onResult(file.name, outcome)
    } catch (e) {
      // `SheetNotFoundError` already carries a message naming the tabs that do
      // exist. Anything else is a genuinely unreadable file.
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
            .xlsx or .xls. The <span className="font-medium text-fg">{KNOWN_SHEET_NAME}</span> tab is
            the one that gets read — it is the only one carrying the room and bed columns.
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
      </CardBody>
    </Card>
  )
}

export default UploadStep
