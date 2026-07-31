'use client'

import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { commitImport, previewImport, type CommitResult, type PreviewResult } from '@/lib/actions/import'
import { forwardFillGroupColumns, type ParsedSheet } from '@/lib/import/parse'
import { buildRow, toImportRowInput, type BuiltRow } from '@/lib/import/rows'
import { IMPORT_FIELDS, type ColumnMapping } from '@/lib/import/mapper'

import { MapStep } from './MapStep'
import { PreviewStep } from './PreviewStep'
import { ResultStep } from './ResultStep'
import { UploadStep } from './UploadStep'

export interface ImportWizardProps {
  eventId: string
  eventCode: string
}

type Step = 'upload' | 'map' | 'preview' | 'result'

const STEP_LABELS: Record<Step, string> = {
  upload: 'Upload',
  map: 'Map columns',
  preview: 'Preview',
  result: 'Done',
}
const STEP_ORDER: Step[] = ['upload', 'map', 'preview', 'result']

export function ImportWizard({ eventId, eventCode }: ImportWizardProps) {
  const [step, setStep] = useState<Step>('upload')

  const [fileName, setFileName] = useState('')
  const [parsed, setParsed] = useState<ParsedSheet | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})

  const [builtRows, setBuiltRows] = useState<BuiltRow[]>([])
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [stepError, setStepError] = useState<string | null>(null)

  const [committing, setCommitting] = useState(false)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)

  const missingRequired = useMemo(
    () => IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] === undefined),
    [mapping],
  )

  function handleParsed(name: string, sheet: ParsedSheet) {
    setFileName(name)
    setParsed(sheet)
    setMapping(sheet.suggestedMapping)
    setStepError(null)
    setStep('map')
  }

  async function handleConfirmMapping() {
    if (!parsed) return
    if (missingRequired.length > 0) {
      setStepError(`Map a column for: ${missingRequired.map((f) => f.label).join(', ')}.`)
      return
    }

    setStepError(null)
    setPreviewing(true)
    try {
      const filled = forwardFillGroupColumns(parsed.rows, mapping)
      const built = filled.map((row) => buildRow(row, parsed.headers, mapping))
      setBuiltRows(built)

      const result = await previewImport(eventId, built.map(toImportRowInput))
      if (!result.ok) {
        setStepError(result.error ?? 'Could not build the preview.')
        return
      }
      setPreview(result)
      setStep('preview')
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Could not build the preview.')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleConfirmImport() {
    setStepError(null)
    setCommitting(true)
    try {
      const result = await commitImport(eventId, eventCode, fileName, builtRows.map(toImportRowInput))
      if (!result.ok) {
        setStepError(result.error ?? 'Import failed.')
        return
      }
      setCommitResult(result)
      setStep('result')
    } catch (e) {
      setStepError(e instanceof Error ? e.message : 'Import failed.')
    } finally {
      setCommitting(false)
    }
  }

  function handleStartOver() {
    setStep('upload')
    setFileName('')
    setParsed(null)
    setMapping({})
    setBuiltRows([])
    setPreview(null)
    setCommitResult(null)
    setStepError(null)
  }

  const blockedCount = preview?.counts.blocked ?? 0
  const importableCount = preview
    ? preview.counts.new + preview.counts.update + preview.counts.unchanged + preview.counts.duplicate
    : 0

  return (
    <div className="flex flex-col gap-4">
      <ol className="flex items-center gap-1 text-xs font-medium text-subtle" aria-label="Import progress">
        {STEP_ORDER.map((s, i) => (
          <li key={s} className="flex items-center gap-1">
            <span
              className={
                s === step
                  ? 'text-brand'
                  : STEP_ORDER.indexOf(step) > i
                    ? 'text-muted'
                    : 'text-subtle'
              }
            >
              {i + 1}. {STEP_LABELS[s]}
            </span>
            {i < STEP_ORDER.length - 1 ? <span aria-hidden>→</span> : null}
          </li>
        ))}
      </ol>

      {stepError ? (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
        >
          {stepError}
        </p>
      ) : null}

      {step === 'upload' ? <UploadStep onParsed={handleParsed} /> : null}

      {step === 'map' && parsed ? (
        <>
          <MapStep
            sheetName={parsed.sheetName}
            headers={parsed.headers}
            rowCount={parsed.rows.length}
            mapping={mapping}
            onChange={setMapping}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleStartOver}>
              Start over
            </Button>
            <Button fullWidth loading={previewing} onClick={handleConfirmMapping}>
              {previewing ? 'Checking against database…' : 'Build preview'}
            </Button>
          </div>
        </>
      ) : null}

      {step === 'preview' && preview ? (
        <>
          <PreviewStep builtRows={builtRows} preview={preview} />
          <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-bg/95 px-4 py-3 pb-safe backdrop-blur-sm">
            <Button variant="secondary" onClick={() => setStep('map')}>
              Back to mapping
            </Button>
            <Button fullWidth loading={committing} disabled={importableCount === 0} onClick={handleConfirmImport}>
              {committing
                ? 'Writing…'
                : `Confirm import (${importableCount} row${importableCount === 1 ? '' : 's'})`}
            </Button>
          </div>
          {blockedCount > 0 ? (
            <p className="text-xs text-subtle">
              {blockedCount} row{blockedCount === 1 ? '' : 's'} cannot be imported and will be skipped
              — see &quot;Cannot import&quot; above.
            </p>
          ) : null}
        </>
      ) : null}

      {step === 'result' && commitResult ? (
        <>
          <ResultStep result={commitResult} />
          <Button fullWidth onClick={handleStartOver}>
            Import another file
          </Button>
        </>
      ) : null}
    </div>
  )
}

export default ImportWizard
