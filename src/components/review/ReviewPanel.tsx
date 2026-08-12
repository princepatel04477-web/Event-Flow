'use client'

import { forwardRef, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { acceptExtractionWithAudit, type FieldReviewDecision } from '@/lib/actions/review-audit'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { StatusPill } from '@/components/ui/StatusPill'
import { Textarea } from '@/components/ui/Textarea'
import { AlertTriangleIcon, CheckCircleIcon, ShieldAlertIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { formatMobile } from '@/lib/phone'
import type { Json } from '@/lib/supabase/database.types'
import {
  SIDE_LABELS,
  buildRpcPayload,
  detectClearAttempts,
  detectInvalidNumbers,
  type ExistingGroupValues,
  type ExistingLegValues,
  type ReviewFormValues,
} from '@/lib/review/payload'
import { getConfidence, LOW_CONFIDENCE_THRESHOLD } from '@/lib/review/confidence'
/**
 * A single field the AI extracted, presented as a review decision.
 * `path` is the FORM key (matches fieldValueMap / buildRpcPayload); `label`
 * is the human name. `modelPath` is the model's dotted key, used for
 * confidence + evidence lookup and the audit trail's field_name.
 */
export interface ReviewFieldDef {
  path: string
  modelPath?: string
  label: string
  kind: 'text' | 'number' | 'select' | 'textarea' | 'date' | 'time'
  aiDisplay: string
  aiJson: unknown
  /** Candidate options for select fields. */
  options?: { value: string; label: string }[]
  /** Where in the transcript the evidence lives, in ms. */
  evidenceStartMs?: number | null
  evidenceEndMs?: number | null
}

export interface ReviewEvidence {
  /** ms offset into the audio this field's claim came from. */
  startMs?: number | null
  endMs?: number | null
  /** The verbatim evidence substring — highlighted in the transcript. */
  quote?: string | null
}

export interface AudioEvidence {
  url: string
  durationSec?: number | null
}

export interface TranscriptSegment {
  speaker: 'staff' | 'guest' | string
  startMs: number
  endMs: number
  text: string
}

export interface ReviewPanelProps {
  eventCode: string
  extractionId: string
  headName: string
  primaryMobile: string | null
  side: string | null
  expectedPax: number
  callDateLabel?: string | null
  callDurationLabel?: string | null
  fields: ReviewFieldDef[]
  fieldEvidence: Record<string, ReviewEvidence>
  values: ReviewFormValues
  existingGroup: ExistingGroupValues
  existingArrival: ExistingLegValues | null
  existingDeparture: ExistingLegValues | null
  audio?: AudioEvidence | null
  transcriptText?: string | null
  transcriptSegments?: TranscriptSegment[] | null
  confidence: unknown
  initialDecisions?: Record<string, 'accepted' | 'edited' | 'rejected'>
}

type Decision = 'accepted' | 'edited' | 'rejected'

const DECISION_META: Record<Decision, { label: string; tone: 'done' | 'active' | 'attention' }> = {
  accepted: { label: 'Accepted', tone: 'done' },
  edited: { label: 'Edited', tone: 'active' },
  rejected: { label: 'Rejected', tone: 'attention' },
}

export function ReviewPanel({
  eventCode,
  extractionId,
  headName,
  primaryMobile,
  side,
  expectedPax,
  callDateLabel,
  callDurationLabel,
  fields,
  fieldEvidence,
  values: initialValues,
  existingGroup,
  existingArrival,
  existingDeparture,
  audio,
  transcriptText,
  transcriptSegments,
  confidence,
  initialDecisions = {},
}: ReviewPanelProps) {
  const router = useRouter()

  // --- Form state -------------------------------------------------------
  const [values, setValues] = useState<ReviewFormValues>(initialValues)
  const [decisions, setDecisions] = useState<Record<string, Decision>>(initialDecisions)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<'accept' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)

  const audioRef = useRef<HTMLAudioElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)

  // --- Derivation -------------------------------------------------------
  const lowFields = useMemo(() => {
    const out = new Set<string>()
    for (const f of fields) {
      if (isLowConfidence(confidence, f.modelPath ?? f.path)) out.add(f.path)
    }
    return out
  }, [fields, confidence])

  /** Low-confidence first, stable order within each group. */
  const orderedFields = useMemo(() => {
    const low = fields.filter((f) => lowFields.has(f.path))
    const rest = fields.filter((f) => !lowFields.has(f.path))
    return [...low, ...rest]
  }, [fields, lowFields])

  const clearAttempts = useMemo(
    () => detectClearAttempts(values, existingGroup, existingArrival, existingDeparture),
    [values, existingGroup, existingArrival, existingDeparture],
  )
  const invalidNumbers = useMemo(() => detectInvalidNumbers(values), [values])
  const unresolved = fields.filter((f) => !decisions[f.path])
  const allDecided = unresolved.length === 0

  // The commit is safe only when every field is decided AND no field would
  // silently keep an old value AND no pax count is malformed.
  const canCommit = allDecided && clearAttempts.length === 0 && invalidNumbers.length === 0

  // --- Actions ----------------------------------------------------------
  function updateField<K extends keyof ReviewFormValues>(key: K, value: ReviewFormValues[K]) {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  function updateLeg(
    direction: 'arrival' | 'departure',
    field: keyof ReviewFormValues['arrival'],
    value: string,
  ) {
    setValues((prev) => ({
      ...prev,
      [direction]: { ...prev[direction], [field]: value },
    }))
  }

  /** Set a decision on a field and clear the edit state for it. */
  function setDecision(path: string, decision: Decision) {
    setDecisions((prev) => ({ ...prev, [path]: decision }))
    setEditingField((cur) => (cur === path ? null : cur))
  }

  /**
   * Toggle the inline editor for a field. Closing an editor (Done) records
   * the human change as `edited` — the reviewer touched the value, which is
   * exactly what the audit trail's edited action means.
   */
  function toggleEditor(path: string) {
    setEditingField((cur) => {
      if (cur !== path) return path
      // Closing the editor: the reviewer edited this field by hand.
      setDecisions((prev) => ({ ...prev, [path]: 'edited' }))
      return null
    })
  }

  /** Tap a field: scrub the audio to its evidence and scroll the transcript to the quote. */
  function focusEvidence(path: string) {
    setSelectedField(path)
    const field = fields.find((f) => f.path === path)
    const evidence = fieldEvidence[field?.modelPath ?? path]

    if (audioRef.current && evidence?.startMs != null) {
      audioRef.current.currentTime = Math.max(0, evidence.startMs / 1000)
      void audioRef.current.play().catch(() => {})
    }

    // Scroll the highlighted quote into view. The transcript row for the
    // segment containing the quote is found by matching the quote text; the
    // fallback scrolls the top of the transcript.
    if (transcriptRef.current) {
      const quote = evidence?.quote
      if (quote) {
        const node = transcriptRef.current.querySelector<HTMLElement>(
          `[data-quote="${escapeSelector(quote)}"]`,
        )
        if (node) {
          node.scrollIntoView({ block: 'center', behavior: 'smooth' })
          return
        }
      }
      transcriptRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  async function handleCommit() {
    if (!canCommit || pendingAction) return
    setPendingAction('accept')
    setError(null)

    const payload = buildRpcPayload(values)

    // The audit trail: every field's AI value and the final value that
    // actually entered guest data. The form values ARE the final values
    // (the reviewer edited them in place), so finalValue is read from the
    // live form state; rejected fields send null.
    const fieldReviews: FieldReviewDecision[] = fields.map((f) => {
      const decision = decisions[f.path]
      const finalValue = decision === 'rejected' ? null : formFieldJsonValue(f, values)
      return {
        // The audit trail's field_name is the model's dotted key — the same
        // key S6 retrieves on, and the key the evidence contract uses.
        fieldName: f.modelPath ?? f.path,
        aiValue: (f.aiJson ?? null) as Json,
        finalValue: finalValue as Json,
        action: decision,
      }
    })

    const result = await acceptExtractionWithAudit(eventCode, extractionId, payload, fieldReviews)

    if (!result.ok) {
      setError(result.error)
      setPendingAction(null)
      return
    }

    router.push(`/${eventCode}/review?done=accepted`)
  }

  // --- Render -----------------------------------------------------------
  const lowCount = lowFields.size

  return (
    <div className="flex flex-col gap-4 pb-4">
      <div className="flex flex-col gap-4">
        {/* Family header */}
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="truncate text-lg font-semibold text-fg">{headName}</h2>
              <p className="mt-0.5 text-sm text-muted">
                {[
                  primaryMobile ? formatMobile(primaryMobile) : null,
                  side ? (SIDE_LABELS[side as keyof typeof SIDE_LABELS] ?? side) : null,
                  `${expectedPax} expected`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </CardTitle>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <StatusPill tone={lowCount > 0 ? 'attention' : 'done'} size="sm">
                {lowCount > 0 ? `${lowCount} low-confidence` : 'Looks solid'}
              </StatusPill>
              {callDurationLabel ? (
                <span className="text-xs text-subtle">{callDurationLabel}</span>
              ) : null}
            </div>
          </CardHeader>
          {callDateLabel ? (
            <CardBody className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm text-muted">
              <span>{callDateLabel}</span>
            </CardBody>
          ) : null}
        </Card>

        {/* Pinned audio + transcript */}
        <Card>
          {audio?.url ? (
            <CardBody className="border-b border-rule py-3">
              {/* The pinned player. A field tap scrubs this exact element. */}
              <audio ref={audioRef} controls src={audio.url} className="w-full" preload="metadata" />
            </CardBody>
          ) : null}

          {transcriptText ? (
            <CardBody className="py-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="eyebrow">Transcript</p>
                {transcriptSegments?.some((s) => s.speaker === 'guest') ? (
                  <span className="text-xs text-subtle">
                    Guest turns in verdigris · staff in slate
                  </span>
                ) : null}
              </div>
              <div
                ref={transcriptRef}
                className="max-h-56 overflow-y-auto text-[0.95rem] leading-relaxed"
                aria-label="Call transcript"
              >
                {transcriptSegments && transcriptSegments.length > 0 ? (
                  transcriptSegments.map((seg, i) => (
                    <TranscriptLine
                      key={i}
                      segment={seg}
                      isSelected={seg.text === fieldEvidence[selectedField ?? '']?.quote}
                    />
                  ))
                ) : (
                  <p className="whitespace-pre-wrap text-fg">{transcriptText}</p>
                )}
              </div>
            </CardBody>
          ) : (
            <CardBody className="py-3 text-sm text-muted">
              No transcript is attached to this extraction. Review the fields below on their own.
            </CardBody>
          )}
        </Card>

        {/* Field decision rows */}
        <div className="flex flex-col gap-3">
          {orderedFields.map((field) => {
            const evidence = fieldEvidence[field.modelPath ?? field.path]
            return (
              <FieldDecisionRow
                key={field.path}
                field={field}
                value={formFieldDisplayValue(field, values)}
                confidence={getConfidence(confidence, field.modelPath ?? field.path)}
                decision={decisions[field.path]}
                editing={editingField === field.path}
                isLow={lowFields.has(field.path)}
                evidenceStartMs={evidence?.startMs}
                evidenceEndMs={evidence?.endMs}
                onFocusEvidence={() => focusEvidence(field.path)}
                onEdit={() => toggleEditor(field.path)}
                onDecide={(d) => setDecision(field.path, d)}
                onChange={(value) => applyFieldChange(field, value, updateField, updateLeg)}
              />
            )
          })}
        </div>
      </div>

      {/* Errors that block commit */}
      {clearAttempts.length > 0 ? (
        <Card className="border-danger/40 bg-tint-danger">
          <CardBody className="py-3 text-sm text-danger">
            <p className="font-semibold">
              {clearAttempts.length} field{clearAttempts.length === 1 ? '' : 's'} can&apos;t be
              cleared this way.
            </p>
            <p className="mt-0.5">
              apply_rsvp_extraction() keeps the existing value whenever a field is left blank.
              Type a replacement value for each flagged field.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-danger bg-tint-danger px-4 py-3 text-sm font-medium text-danger"
        >
          {error}
        </p>
      ) : null}

      {/* Commit */}
      <Card>
        <CardBody className="flex flex-col gap-3">
          {unresolved.length > 0 ? (
            <p className="text-sm text-muted">
              {unresolved.length} field{unresolved.length === 1 ? '' : 's'} still need a decision.
            </p>
          ) : (
            <p className="text-sm text-success">
              Every field has a decision. Ready to commit to guest data.
            </p>
          )}

          {summaryOpen ? (
            <CommitSummary
              fields={fields}
              decisions={decisions}
              values={values}
              onConfirm={handleCommit}
              onCancel={() => setSummaryOpen(false)}
              busy={pendingAction !== null}
            />
          ) : (
            <Button
              size="lg"
              fullWidth
              onClick={() => setSummaryOpen(true)}
              disabled={!canCommit || pendingAction !== null}
            >
              Review &amp; commit
            </Button>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TranscriptLine({
  segment,
  isSelected,
}: {
  segment: TranscriptSegment
  isSelected?: boolean
}) {
  const isGuest = segment.speaker === 'guest'
  return (
    <div
      data-quote={escapeSelector(segment.text)}
      className={cn(
        'rounded-lg px-2 py-1',
        isSelected && 'bg-brand-tint ring-1 ring-brand/40',
      )}
    >
      <span
        className={cn(
          'text-[0.6875rem] font-mono uppercase tracking-eyebrow',
          isGuest ? 'text-ledger-green' : 'text-muted',
        )}
      >
        {isGuest ? 'Guest' : 'Staff'}
      </span>
      <p className={cn('text-fg', isGuest && 'text-ledger-green-strong')}>{segment.text}</p>
    </div>
  )
}

interface FieldRowProps {
  field: ReviewFieldDef
  value: string
  confidence: number | null
  decision: Decision | undefined
  editing: boolean
  isLow: boolean
  evidenceStartMs?: number | null
  evidenceEndMs?: number | null
  onFocusEvidence: () => void
  onEdit: () => void
  onDecide: (d: Decision) => void
  onChange: (value: string) => void
}

const FieldDecisionRow = forwardRef<HTMLDivElement, FieldRowProps>(function FieldDecisionRow(
  {
    field,
    value,
    confidence,
    decision,
    editing,
    isLow,
    evidenceStartMs,
    evidenceEndMs,
    onFocusEvidence,
    onEdit,
    onDecide,
    onChange,
  },
  ref,
) {
  const evidence = evidenceStartMs != null
  const meta = decision ? DECISION_META[decision] : null

  return (
    <div
      ref={ref}
      className={cn(
        'rounded-2xl border bg-surface',
        isLow ? 'border-ledger-red/35' : 'border-rule',
        decision && meta?.tone === 'done' && 'border-ledger-green/35',
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        {/* The margin rule: low-confidence fields break into the register's
            leading edge. This is the ledger-red = attention rule. */}
        <div
          className={cn(
            'w-1 shrink-0 self-stretch rounded-full',
            isLow ? 'bg-ledger-red' : 'bg-transparent',
          )}
          aria-hidden
        />

        <button
          type="button"
          onClick={onFocusEvidence}
          className="tap flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-1 py-0.5 text-left hover:bg-surface-2"
          title={evidence ? 'Tap to hear the evidence' : undefined}
        >
          <span className="eyebrow flex items-center gap-1.5">
            {field.label}
            {confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD ? (
              <ShieldAlertIcon className="h-3 w-3 text-ledger-red" />
            ) : null}
          </span>
          <span
            className={cn(
              'max-w-full text-base leading-snug break-words',
              decision === 'rejected' ? 'text-muted line-through' : 'text-fg',
            )}
          >
            {value || '—'}
          </span>
          {evidenceStartMs != null ? (
            <span className="text-xs text-subtle">
              {formatEvidenceMs(evidenceStartMs)}
              {evidenceEndMs != null ? `–${formatEvidenceMs(evidenceEndMs)}` : ''}
              · tap to hear
            </span>
          ) : null}
        </button>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {confidence !== null ? (
            <Badge tone={confidence < LOW_CONFIDENCE_THRESHOLD ? 'warning' : 'neutral'} size="sm">
              {Math.round(confidence * 100)}%
            </Badge>
          ) : null}
          {decision && meta ? (
            <StatusPill tone={meta.tone} size="sm">
              {meta.label}
            </StatusPill>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="border-t border-rule px-4 py-3">
          <FieldEditor field={field} value={value} onChange={onChange} />
        </div>
      ) : null}

      <div className="flex items-center gap-2 border-t border-rule px-4 py-2.5">
        <Button
          variant="secondary"
          size="md"
          className="flex-1"
          onClick={onEdit}
          disabled={decision === 'rejected'}
        >
          {editing ? 'Done' : 'Edit'}
        </Button>
        <Button
          variant="primary"
          size="md"
          className="flex-1"
          onClick={() => onDecide('accepted')}
          disabled={editing}
        >
          <CheckCircleIcon className="h-4 w-4" />
          Accept
        </Button>
        <Button
          variant="danger"
          size="md"
          className="flex-1"
          onClick={() => onDecide('rejected')}
          disabled={editing}
        >
          <AlertTriangleIcon className="h-4 w-4" />
          Reject
        </Button>
      </div>
    </div>
  )
})

function FieldEditor({
  field,
  value,
  onChange,
}: {
  field: ReviewFieldDef
  value: string
  onChange: (value: string) => void
}) {
  if (field.kind === 'select' && field.options) {
    return (
      <Select
        label={field.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        options={field.options}
        placeholder="Not set"
      />
    )
  }
  if (field.kind === 'textarea') {
    return (
      <Textarea
        label={field.label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    )
  }
  return (
    <Input
      label={field.label}
      type={
        field.kind === 'number'
          ? 'number'
          : field.kind === 'date'
            ? 'date'
            : field.kind === 'time'
              ? 'time'
              : 'text'
      }
      inputMode={field.kind === 'number' ? 'numeric' : undefined}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

function CommitSummary({
  fields,
  decisions,
  values,
  onConfirm,
  onCancel,
  busy,
}: {
  fields: ReviewFieldDef[]
  decisions: Record<string, Decision>
  values: ReviewFormValues
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  const changed = fields.filter((f) => {
    const d = decisions[f.path]
    return d === 'edited' || d === 'rejected'
  })

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-xl bg-surface-2 px-3.5 py-3">
        <p className="eyebrow mb-1.5">What will change</p>
        <ul className="flex flex-col gap-1.5">
          {changed.length === 0 ? (
            <li className="text-sm text-muted">
              Accepting the AI&apos;s values as-is — no edits to guest data beyond what it proposed.
            </li>
          ) : (
            changed.map((f) => (
              <li key={f.path} className="flex items-start gap-2 text-sm">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                <span className="text-fg">
                  <span className="font-medium">{f.label}:</span>{' '}
                  {decisions[f.path] === 'rejected' ? (
                    <span className="text-muted line-through">
                      {formFieldDisplayValue(f, values) || 'AI value'} — left unchanged
                    </span>
                  ) : (
                    <span>{formFieldDisplayValue(f, values) || '—'}</span>
                  )}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
      <p className="text-xs text-subtle">
        Commits through the review RPC — the only path from AI output into guest data. This is
        recorded, not reversible from here.
      </p>
      <div className="flex gap-2">
        <Button variant="secondary" fullWidth onClick={onCancel} disabled={busy}>
          Keep reviewing
        </Button>
        <Button variant="primary" fullWidth onClick={onConfirm} loading={busy}>
          Commit
        </Button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Read the current form value for a field back out as a JSON value for the
 * audit trail. Rejected fields are handled by the caller (null).
 */
function formFieldJsonValue(field: ReviewFieldDef, values: ReviewFormValues): unknown {
  const raw = formFieldDisplayValue(field, values)
  if (field.kind === 'number') {
    const n = Number(raw)
    return raw === '' || Number.isNaN(n) ? null : n
  }
  return raw === '' ? null : raw
}

/** The display string for a field from the live form values. */
function formFieldDisplayValue(field: ReviewFieldDef, values: ReviewFormValues): string {
  const map = fieldValueMap(values)
  const raw = map[field.path]
  return typeof raw === 'string' ? raw : raw != null ? String(raw) : ''
}

/** Map a CONFIDENCE_PATHS-style dotted key onto the live form state. */
function fieldValueMap(values: ReviewFormValues): Record<string, string> {
  return {
    rsvpStatus: values.rsvpStatus,
    confirmedPax: values.confirmedPax,
    side: values.side,
    remarks: values.remarks,
    'arrival.mode': values.arrival.mode,
    'arrival.date': values.arrival.date,
    'arrival.time': values.arrival.time,
    'arrival.reference': values.arrival.reference,
    'arrival.point': values.arrival.point,
    'arrival.pax': values.arrival.pax,
    'departure.mode': values.departure.mode,
    'departure.date': values.departure.date,
    'departure.time': values.departure.time,
    'departure.reference': values.departure.reference,
    'departure.point': values.departure.point,
    'departure.pax': values.departure.pax,
  }
}

/** Route an edited field value back into the form state. */
function applyFieldChange(
  field: ReviewFieldDef,
  value: string,
  updateField: (
    key: keyof ReviewFormValues,
    value: ReviewFormValues[keyof ReviewFormValues],
  ) => void,
  updateLeg: (
    direction: 'arrival' | 'departure',
    field: keyof ReviewFormValues['arrival'],
    value: string,
  ) => void,
) {
  const path = field.path
  if (path === 'rsvpStatus') return updateField('rsvpStatus', value)
  if (path === 'confirmedPax') return updateField('confirmedPax', value)
  if (path === 'side') return updateField('side', value)
  if (path === 'remarks') return updateField('remarks', value)
  if (path.startsWith('arrival.')) {
    const key = path.slice('arrival.'.length) as keyof ReviewFormValues['arrival']
    return updateLeg('arrival', key, value)
  }
  if (path.startsWith('departure.')) {
    const key = path.slice('departure.'.length) as keyof ReviewFormValues['departure']
    return updateLeg('departure', key, value)
  }
}

function formatEvidenceMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

function isLowConfidence(confidence: unknown, path: string): boolean {
  const v = getConfidence(confidence, path)
  return v !== null && v < LOW_CONFIDENCE_THRESHOLD
}

/** CSS attribute values can't contain quotes — collapse them safely. */
function escapeSelector(value: string): string {
  return value.replace(/["\\]/g, '')
}
