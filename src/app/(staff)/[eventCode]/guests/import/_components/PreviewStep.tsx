'use client'

import { useState } from 'react'

import { CalendarIcon, ShieldAlertIcon } from '@/components/icons'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import type { CommitResult } from '@/lib/actions/import'
import { commitImport } from '@/lib/actions/import'
import type { ImportContext } from '@/lib/actions/import'
import { lostResponseMessage } from '@/lib/errors'
import type { ParsedFamily, ParsedFamilySheet } from '@/lib/import/families'
import type { LayoutNote } from '@/lib/import/layout'
import type { NormalisedSide, SubSide } from '@/lib/import/normalize'

import { FamilyList } from './FamilyList'
import {
  SideBifurcationSelector,
  type ImportPrimarySide,
} from './SideBifurcationSelector'
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
   * headcount to work with. It is therefore stated plainly on the preview.
   */
  contactsFallback: boolean
}

export interface PreviewStepProps {
  eventId: string
  fileName: string
  outcome: PreviewOutcome
  context: ImportContext
  defaultSide: ImportPrimarySide | null
  defaultSubSide: SubSide | null
  onSideChange: (side: ImportPrimarySide | null, subSide: SubSide | null) => void
  /**
   * The commit landed. The counts are handed UP rather than rendered here,
   * because a successful import unmounts this component in the same commit —
   * see `CommitSummary`. The parent resets the preview and keeps showing them.
   */
  onCommitted: (summary: CommitResult['summary']) => void
  onAdjustMapping?: () => void
}

/**
 * The preview. Read-only until the operator explicitly confirms.
 *
 * The whole screen parses in the browser; nothing is sent anywhere until the
 * "Confirm import" button is pressed. On confirm, the parsed families are sent
 * to `public.commit_guest_import()` — one transaction, one outcome.
 */
type SideOverride = { side: NormalisedSide | null; subSide: SubSide | null }

function familyRowKey(f: ParsedFamily): string {
  return `${f.familyIndex}-${f.sourceRowIndex}`
}

export function PreviewStep({
  eventId,
  fileName,
  outcome,
  context,
  defaultSide,
  defaultSubSide,
  onSideChange,
  onCommitted,
  onAdjustMapping,
}: PreviewStepProps) {
  const { result } = outcome
  const { counts, dateWindow } = result

  const [busy, setBusy] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const [overrideState, setOverrideState] = useState<{
    source: ParsedFamilySheet
    map: Record<string, SideOverride>
  }>({ source: result, map: {} })

  const activeOverrides = overrideState.source === result ? overrideState.map : {}

  const effectiveFamilies = result.families.map((f) => {
    const ov = activeOverrides[familyRowKey(f)]
    return ov ? { ...f, side: ov.side, subSide: ov.subSide } : f
  })

  const effectiveResult: ParsedFamilySheet = {
    ...result,
    families: effectiveFamilies,
  }

  // Detect whether the parsed sheet already carries distinct row-level sides
  // (e.g. a master sheet with both Groom and Bride rows).
  const distinctRowSides = new Set(
    result.families.filter((f) => f.side !== null).map((f) => `${f.side}:${f.subSide ?? ''}`),
  )
  const hasMixedColumnSides = distinctRowSides.size > 1

  function handleSelectorChange(nextSide: ImportPrimarySide | null, nextSubSide: SubSide | null) {
    onSideChange(nextSide, nextSubSide)
    const nextMap: Record<string, SideOverride> = { ...activeOverrides }
    for (const f of result.families) {
      if (!hasMixedColumnSides || f.side === null) {
        nextMap[familyRowKey(f)] = {
          side: nextSide,
          subSide: nextSide ? nextSubSide : null,
        }
      }
    }
    setOverrideState({ source: result, map: nextMap })
  }

  function handleApplySideToAll() {
    if (!defaultSide) return
    const nextMap: Record<string, SideOverride> = {}
    for (const f of result.families) {
      nextMap[familyRowKey(f)] = {
        side: defaultSide,
        subSide: defaultSubSide,
      }
    }
    setOverrideState({ source: result, map: nextMap })
  }

  function handleFamilySideChange(
    key: string,
    side: NormalisedSide | null,
    subSide: SubSide | null,
  ) {
    setOverrideState({
      source: result,
      map: {
        ...activeOverrides,
        [key]: { side, subSide },
      },
    })
  }

  const blocked = effectiveFamilies.filter((f) => !f.canImport).length
  const unassignedSideCount = effectiveFamilies.filter((f) => f.side === null).length
  const hasNoPhones =
    effectiveFamilies.length > 0 && effectiveFamilies.every((f) => !f.primaryMobile)

  async function handleCommit() {
    setBusy(true)
    setCommitError(null)
    try {
      const payload = effectiveFamilies.map((f) => ({
        rowNumber: f.sourceRowIndex,
        raw: f.raw,
        familyNumber: f.familyNumber,
        headName: f.headName,
        primaryMobile: f.primaryMobile,
        altMobile: f.altMobile ?? null,
        remark: f.remark,
        place: f.place,
        expectedPax: f.expectedPax,
        side: f.side,
        subSide: f.subSide,
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
      {/* Top of the screen: warning if no phone numbers are detected */}
      {hasNoPhones ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-warning bg-tint-warning p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldAlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
            <div>
              <p className="text-sm font-semibold text-warning">
                No phone numbers detected
              </p>
              <p className="mt-1 text-sm leading-relaxed text-fg">
                None of the imported guests have a phone number. If your sheet has phone numbers, click &ldquo;Select Phone Column&rdquo; to choose the correct column.
              </p>
            </div>
          </div>
          {onAdjustMapping ? (
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={onAdjustMapping}
              className="shrink-0 self-start sm:self-auto"
            >
              Select Phone Column
            </Button>
          ) : null}
        </div>
      ) : null}

      {/* Top of the screen: whether this was read as a simple/flexible list */}
      {outcome.contactsFallback ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-info bg-tint-info p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-info">
              Flexible / Custom list
            </p>
            <p className="mt-1 text-sm leading-relaxed text-fg">
              Guests were parsed using detected columns. Travel legs are not included in this layout.
            </p>
          </div>
          {onAdjustMapping ? (
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={onAdjustMapping}
              className="shrink-0 self-start sm:self-auto"
            >
              Adjust columns
            </Button>
          ) : null}
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
              {outcome.notes.map((n, i) => (
                <li key={`${n.column}-${i}`}>
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

      <div className="flex flex-col gap-2">
        <SideBifurcationSelector
          side={defaultSide}
          subSide={defaultSubSide}
          onChange={handleSelectorChange}
          title="Side & Family Branch Assignment"
          description={
            hasMixedColumnSides
              ? 'Your sheet includes multiple sides from its columns. Selecting here fills any unassigned rows, or you can override all rows.'
              : unassignedSideCount > 0
                ? `${unassignedSideCount} famil${unassignedSideCount === 1 ? 'y has' : 'ies have'} no side yet — pick Groom Side or Bride Side and Father’s / Mother’s branch.`
                : 'Change Groom / Bride side or Father’s / Mother’s bifurcation before confirming.'
          }
          compact
        />
        {hasMixedColumnSides && defaultSide ? (
          <div className="flex justify-end">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleApplySideToAll}
            >
              Apply to all {effectiveFamilies.length} families
            </Button>
          </div>
        ) : null}
      </div>

      <SummaryBar result={effectiveResult} />

      <WarningsList warnings={result.warnings} />

      <FamilyList families={effectiveFamilies} onChangeSide={handleFamilySideChange} />

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
    <div className="sticky bottom-nav z-40 -mx-4 border-t border-border bg-bg px-4 py-3 md:bottom-0 md:pb-safe">
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
