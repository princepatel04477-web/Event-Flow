'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'

import { ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { LinkButton } from '@/components/ui/LinkButton'
import type { CommitResult, ImportContext } from '@/lib/actions/import'
import type { ImportOutcome, KnownSheetFailure } from '@/lib/import/knownSheet'

import { CommitSummary } from './CommitSummary'
import { PreviewStep } from './PreviewStep'
import { UploadStep } from './UploadStep'

export interface ImportPreviewProps {
  eventId: string
  /** `events.starts_on`. Null is a real state — the column is nullable. */
  eventStartsOn: string | null
  /** `events.ends_on`. Also nullable. */
  eventEndsOn: string | null
  context: ImportContext
}

/**
 * Upload → preview. Two steps, and no third.
 *
 * The manual column-mapping step is gone from this flow. It existed to make an
 * unknown workbook importable, and there is no import here to make anything
 * importable FOR; meanwhile a sheet that does not resolve against the known
 * layout is a sheet whose CONTACT column we cannot swear to, and a preview
 * built on a guessed column mapping is a preview that lies quietly. So a
 * layout mismatch stops and names the missing headers. `mapper.ts` and
 * `parseWorkbook` are untouched in the library for the second event's
 * differently-shaped workbook.
 */
export function ImportPreview({
  eventId,
  eventStartsOn,
  eventEndsOn,
  context,
}: ImportPreviewProps) {
  const pathname = usePathname()
  const [fileName, setFileName] = useState('')
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const [error, setError] = useState<string | null>(null)
  /**
   * The last commit's counts, kept AFTER the preview is thrown away.
   *
   * This is the whole of the M34 fix. `PreviewStep` is unmounted the moment an
   * import succeeds — the preview holds every parsed family and the screen
   * deliberately drops them once they are written — so a summary it rendered
   * itself was set and destroyed in the same React commit and the operator
   * landed back on "Choose the calling list" with no idea whether 238 families
   * had been written or none. Holding it one level up is what lets it survive
   * the reset that follows it.
   */
  const [summary, setSummary] = useState<CommitResult['summary']>(null)

  /**
   * `…/guests/import` → `…/guests`. The screen is also reachable through the
   * `/:eventCode/import` redirect, so the event code is not a prop here; the
   * pathname is the one place it is certain. When it cannot be worked out the
   * link is simply not offered — the Done button below it always is.
   */
  const guestListHref = pathname.endsWith('/import')
    ? pathname.slice(0, -'/import'.length)
    : null

  function handleResult(name: string, next: ImportOutcome) {
    setFileName(name)
    setOutcome(next)
    setError(null)
    // A new file replaces whatever the last one did. The summary is a record
    // of an import, and it stops being that the moment the operator moves on.
    setSummary(null)
  }

  function handleStartOver() {
    setFileName('')
    setOutcome(null)
    setError(null)
    setSummary(null)
  }

  /** A commit landed: drop the preview, KEEP the counts. */
  function handleCommitted(next: CommitResult['summary']) {
    setSummary(next)
    setFileName('')
    setOutcome(null)
    setError(null)
  }

  // A sheet full of "4TH" and an event with no start date cannot produce a
  // single travel date between them. Uploading anyway would render a preview
  // whose every arrival is blank, and the operator would read that as "the
  // sheet has no dates" rather than "this event has no start date". Stop here.
  if (!eventStartsOn) {
    return (
      <Card>
        <CardBody className="flex flex-col items-start gap-3">
          <span
            className="flex h-11 w-11 items-center justify-center rounded-full bg-tint-warning text-warning"
            aria-hidden
          >
            <ShieldAlertIcon className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold text-fg">This event has no start date</p>
            <p className="mt-1 text-sm text-muted">
              The calling list writes arrival and departure dates as bare ordinals — “4TH”, “5TH”.
              An ordinal only becomes a date once the month and year are known, and that comes from
              the event’s start date. Without it every travel date in the preview would be blank,
              which would look like a fault in the sheet rather than a missing setting here.
            </p>
            <p className="mt-2 text-sm text-muted">
              Set the start date (and the end date, which narrows the ordinals further), then come
              back.
            </p>
          </div>
          <LinkButton href="/admin/events" size="md">
            Set the event dates
          </LinkButton>
        </CardBody>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top of the screen, above the upload step it resets to. The counts are
          the answer to "did my import land?", and they stay until the operator
          either opens the guest list or deliberately starts another file. */}
      {summary ? (
        <CommitSummary
          counts={summary}
          guestListHref={guestListHref}
          onDone={() => setSummary(null)}
        />
      ) : null}

      {!context.ok && context.error && !outcome ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-warning bg-tint-warning px-4 py-3 text-sm text-warning"
        >
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{context.error}</span>
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {outcome === null ? (
        <UploadStep
          eventStartsOn={eventStartsOn}
          eventEndsOn={eventEndsOn}
          onResult={handleResult}
          onError={setError}
        />
      ) : outcome.ok ? (
        <>
          <PreviewStep
            eventId={eventId}
            fileName={fileName}
            // `layout` exists only on the known-layout success. Its absence is
            // how we know parseImportFile fell through to the contacts sheet:
            // both shapes carry the same `result`, which is precisely why the
            // fallback was invisible.
            outcome={{ ...outcome, contactsFallback: !('layout' in outcome) }}
            context={context}
            // Hands the counts up before the preview is dropped — see
            // `handleCommitted`. NOT `handleStartOver`, which discards them.
            onCommitted={handleCommitted}
          />
          <Button variant="secondary" fullWidth onClick={handleStartOver}>
            Choose a different file
          </Button>
        </>
      ) : (
        <>
          <LayoutMismatch fileName={fileName} failure={outcome} />
          <Button variant="secondary" fullWidth onClick={handleStartOver}>
            Choose a different file
          </Button>
        </>
      )}
    </div>
  )
}

/**
 * The layout did not resolve. Name every missing header and stop.
 *
 * No partial preview, no best guess. Three of this sheet's headers ("Time",
 * "Mode", "Details") appear twice and are told apart only by where the two
 * date columns sit; guessing at that is how a departure time lands on an
 * arrival leg for 238 families at once.
 */
function LayoutMismatch({ fileName, failure }: { fileName: string; failure: KnownSheetFailure }) {
  return (
    <Card>
      <CardBody className="flex flex-col gap-3">
        <div>
          <p className="text-base font-semibold text-fg">This sheet was not read</p>
          <p className="mt-1 text-sm text-muted">
            <span className="font-medium text-fg">{fileName}</span> · sheet{' '}
            <span className="font-medium text-fg">{failure.sheetName}</span>
          </p>
          <p className="mt-1 text-sm text-muted">{failure.reason}</p>
        </div>

        {failure.missing.length > 0 ? (
          <div>
            <p className="text-sm font-semibold text-fg">
              {failure.missing.length} column{failure.missing.length === 1 ? '' : 's'} could not be
              found
            </p>
            <ul className="mt-1 flex flex-col gap-1.5">
              {failure.missing.map((m) => (
                <li key={m.column} className="text-sm">
                  <span className="font-medium text-fg">{m.label}</span>
                  <span className="text-muted"> — {m.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <p className="text-xs text-subtle">
          Headers found on the closest matching row:{' '}
          {failure.headers.filter(Boolean).join(', ') || '(none)'}
        </p>

        <p className="text-sm text-muted">
          Nothing was parsed and nothing was written. Correct the headers in Excel and upload again.
        </p>
      </CardBody>
    </Card>
  )
}

export default ImportPreview
