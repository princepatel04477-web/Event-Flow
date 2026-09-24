'use client'

import { useState } from 'react'

import { CalendarIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import type { CommitResult } from '@/lib/actions/import'
import { commitImport } from '@/lib/actions/import'
import type { ImportContext } from '@/lib/actions/import'
import { lostResponseMessage } from '@/lib/errors'
import type { ParsedFamilySheet } from '@/lib/import/families'
import type { LayoutNote } from '@/lib/import/layout'

import { FamilyList } from './FamilyList'
import { SummaryBar } from './SummaryBar'
import { WarningsList } from './WarningsList'

/** The shared success shape both the known-layout and contacts paths produce. */
export interface PreviewOutcome {
  sheetName: string
  /** 1-based row number the headers were found on. */
  headerRowNumber: number
  /** Optional-column notes, for the preview's info lines. */
  notes: LayoutNote[]
  result: ParsedFamilySheet
  /**
   * True when the full CALLING MASTER LIST layout did NOT resolve and
   * `parseImportFile` fell back to the contacts layout (name + mobile only).
   *
   * The fallback is deliberate and useful — a plain two-column contact list
   * is a legitimate way to start an event. What is NOT acceptable is that it
   * looked identical to a full import: a sheet headed
   * Family/Serial/Guest Name/City/Phone/Headcount parses happily, reports its
   * families and guests, and silently discards Pax and every travel column.
   * Those are exactly the headers someone writes when inventing their own
   * sheet, and the gap only surfaces later, when room allocation has no
   * headcount to work with.
   */
  contactsFallback: boolean
}

export interface PreviewStepProps {
  eventId: string
  fileName: string
  outcome: PreviewOutcome
  context: ImportContext
  /**
   * The commit landed. The counts are handed UP rather than rendered here,
   * because a successful import unmounts this component in the same commit —
   * see `CommitSummary`. The parent resets the preview and keeps showing them.
   */
  onCommitted: (summary: CommitResult['summary']) => void
}

/**
 * The preview. Read-only until the operator explicitly confirms.
 *
 * The whole screen parses in the browser; nothing is sent anywhere until the
 * "Confirm import" button is pressed. On confirm, the parsed families are sent
 * to `public.commit_guest_import()` — one transaction, one outcome.
 */
export function PreviewStep({
  eventId,
  fileName,
  outcome,
  context,
  onCommitted,
}: PreviewStepProps) {
  const { result } = outcome
  const { counts, dateWindow } = result

  const [busy, setBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)

  const blocked = result.families.filter((f) => !f.canImport).length

  async function handleCommit() {
    setBusy(true)
    setCommitError(null)
    try {
      const payload = result.families.map((f) => ({
        rowNumber: f.sourceRowIndex,
        raw: f.raw,
        familyNumber: f.familyNumber,
        headName: f.headName,
        primaryMobile: f.primaryMobile,
        place: f.place,
        expectedPax: f.expectedPax,
        canImport: f.canImport,
        blockReason: f.blockReason,
        arrival: f.arrival,
        departure: f.departure,
      }))
      const res = await commitImport(eventId, fileName, payload)
      if (!res.ok) {
        setCommitError(res.error ?? 'The import did not land.')
        return
      }
      // Hand the counts up. The parent resets the preview and renders them
      // above the upload step; setting them here would be destroyed by that
      // same reset, which is exactly how the summary went missing (M34).
      onCommitted(res.summary)
    } catch {
      // The action can REJECT rather than return — a dropped connection is the
      // ordinary cause. It may still have committed, so never say it failed.
      setCommitError(lostResponseMessage('the guest list'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top of the screen, not buried in the warnings list. This is the one
          thing that changes what the operator should DO — everything below it
          describes an import that is about to drop half their columns. */}
      {outcome.contactsFallback ? (
        <div
          role="alert"
          className="rounded-2xl border border-ledger-red bg-red-tint px-4 py-3"
        >
          <p className="text-sm font-semibold text-ledger-red">
            Reading this as a contacts sheet: name and mobile only.
          </p>
          <p className="mt-1 text-sm leading-relaxed text-fg">
            The full calling-list columns were not found, so{' '}
            <span className="font-semibold">Guest counts and every travel column will be
            ignored</span>{' '}
            — arrival and departure dates, times, modes, pickup and drop. Names
            and phone numbers still import correctly.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fg">
            If you expected those to import, stop and{' '}
            <a
              href="/nuvent-guest-list-template.xlsx"
              download
              className="font-semibold text-ledger-red underline underline-offset-2"
            >
              download the template
            </a>{' '}
            — its headers are the ones this importer looks for.
          </p>
        </div>
      ) : null}

      <Card>
        <CardBody className="flex flex-col gap-2">
          <p className="text-sm text-muted">
            <span className="font-medium text-fg">{fileName}</span> · sheet{' '}
            <span className="font-medium text-fg">{outcome.sheetName}</span> · headers on row{' '}
            <span className="tabular-nums">{outcome.headerRowNumber}</span>
          </p>

          {/* Read every non-blank row and say where each one went. A row that
              vanished without a number beside it is how 465 people quietly
              become 460. */}
          <p className="text-sm text-muted">
            {counts.sheetRows} non-blank row{counts.sheetRows === 1 ? '' : 's'} read →{' '}
            {counts.families} famil{counts.families === 1 ? 'y' : 'ies'}, {counts.members}{' '}
            {counts.members === 1 ? 'person' : 'people'}, {counts.orphans} orphan
            {counts.orphans === 1 ? '' : 's'}. {counts.blankRowsSkipped} blank row
            {counts.blankRowsSkipped === 1 ? '' : 's'} skipped.
          </p>

          <p className="flex items-start gap-2 text-sm text-muted">
            <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden />
            <span>
              Dates written as ordinals (“4TH”) were resolved against{' '}
              <span className="font-medium text-fg">{dateWindow.description}</span>.
            </span>
          </p>

          {outcome.notes.length > 0 ? (
            <ul className="flex flex-col gap-0.5 text-xs text-subtle">
              {outcome.notes.map((n) => (
                <li key={n.column}>
                  <span className="font-medium">{n.label}</span> — {n.detail}
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      {context.ok && context.existingFamilies > 0 ? (
        <p className="rounded-xl border border-info bg-tint-info px-4 py-3 text-sm text-info">
          This event already holds {context.existingFamilies} famil
          {context.existingFamilies === 1 ? 'y' : 'ies'} and {context.existingGuests}{' '}
          {context.existingGuests === 1 ? 'person' : 'people'}. Matching families will be
          updated in place; the rest will be added.
        </p>
      ) : null}

      {!context.ok && context.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-warning bg-tint-warning px-4 py-3 text-sm text-warning"
        >
          <ShieldAlertIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{context.error}</span>
        </p>
      ) : null}

      {commitError ? (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
        >
          {commitError}
        </p>
      ) : null}

      <SummaryBar result={result} />

      <WarningsList warnings={result.warnings} />

      <FamilyList families={result.families} />

      {/* No summary branch here: a successful commit unmounts this component,
          so the counts are rendered by `ImportPreview` (see CommitSummary). */}
      <ConfirmImportBar
        busy={busy}
        blocked={blocked}
        total={result.families.length}
        onConfirm={handleCommit}
      />
    </div>
  )
}

/**
 * The sticky confirm bar — replaces the old "Nothing has been written" notice.
 * Only families that can import are committed; blocked ones are recorded as
 * failed rows so the operator can see exactly what was skipped and why.
 */
function ConfirmImportBar({
  busy,
  blocked,
  total,
  onConfirm,
}: {
  busy: boolean
  blocked: number
  total: number
  onConfirm: () => void
}) {
  const commitable = total - blocked
  return (
    // `bottom-nav`, NOT `bottom-0`. The tab bar is `fixed … z-40` pinned to the
    // viewport bottom, so a bar stuck to `bottom-0` sits UNDER it: the button
    // renders, `toBeVisible()` passes, and the tap lands on the tab bar — the
    // import could never be committed (B10). `bottom-nav` is the same offset
    // `BottomBar` computes (`--ef-tabbar-h` + the gesture inset), so the two
    // cannot drift apart. `z-40` keeps this above the tab bar on the off chance
    // they ever do overlap, and `md:bottom-0 md:pb-safe` drops the offset on
    // desktop, where the tab bar is `md:hidden`.
    //
    // Sticky rather than fixed on purpose: it stays in the flow, so it reserves
    // its own height and the summary row above the button stays readable even
    // next to the bottom of a 238-row list. No `pb-nav-bottombar` clearance is
    // needed for the same reason — that is for a FIXED bar, which reserves
    // nothing and would cover the last families.
    <div className="sticky bottom-nav z-40 -mx-4 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur-sm md:bottom-0 md:pb-safe">
      <p className="text-sm text-muted">
        {commitable} of {total} famil{total === 1 ? 'y' : 'ies'} will be written.
        {blocked > 0 ? ` ${blocked} blocked famil${blocked === 1 ? 'y' : 'ies'} will be recorded as failed.` : ''}{' '}
        RSVP status is never overwritten by a sheet.
      </p>
      <Button
        type="button"
        size="lg"
        fullWidth
        loading={busy}
        disabled={commitable === 0}
        onClick={onConfirm}
      >
        Confirm import
      </Button>
    </div>
  )
}

export default PreviewStep
