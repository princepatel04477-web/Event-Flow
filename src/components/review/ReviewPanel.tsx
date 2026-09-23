'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { acceptExtractionWithAudit, type FieldReviewDecision } from '@/lib/actions/review-audit'
import { BottomBar } from '@/components/ui/BottomBar'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Textarea } from '@/components/ui/Textarea'
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

/**
 * The one-word state of a decided field, as a `Row`-style word plus a tone.
 * Wording is fixed here so the row, the commit summary and the audit trail all
 * say the same thing.
 */
const DECISION_META: Record<Decision, { label: string; tone: 'done' | 'active' | 'attention' }> = {
  accepted: { label: 'Accepted', tone: 'done' },
  edited: { label: 'Edited', tone: 'active' },
  rejected: { label: 'Rejected', tone: 'attention' },
}

const DOT_TONE: Record<'neutral' | 'done' | 'waiting' | 'problem', string> = {
  neutral: 'bg-subtle',
  done: 'bg-ledger-green',
  waiting: 'bg-ledger-amber',
  problem: 'bg-ledger-red',
}

const DECISION_DOT: Record<Decision, keyof typeof DOT_TONE> = {
  accepted: 'done',
  edited: 'waiting',
  rejected: 'problem',
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

    router.push(`/${eventCode}/rsvp/review?done=accepted`)
  }

  // --- Render -----------------------------------------------------------
  const lowCount = lowFields.size

  const familyMeta = [
    primaryMobile ? formatMobile(primaryMobile) : null,
    side ? (SIDE_LABELS[side as keyof typeof SIDE_LABELS] ?? side) : null,
    `${expectedPax} expected`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex flex-col gap-4 pb-nav-bottombar">
      <div className="flex flex-col gap-4">
        {/* WHO AND WHEN. The shell's header names the section; the record's own
            identity is the first thing in the body. */}
        <section
          className="flex flex-col gap-2 rounded-2xl border border-rule bg-surface p-4 shadow-e1"
          aria-label={`Reviewing ${headName}`}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="line-clamp-2 font-display text-xl leading-tight font-semibold break-words text-ink">
                {headName}
              </h2>
              <p className="mt-1 truncate text-sm text-muted">{familyMeta}</p>
            </div>
            <span className="flex shrink-0 items-center gap-2 pt-1">
              <span
                aria-hidden
                className={cn('h-2.5 w-2.5 rounded-full', lowCount > 0 ? DOT_TONE.problem : DOT_TONE.done)}
              />
              <span className="text-sm font-medium text-muted">
                {lowCount > 0
                  ? `${lowCount} to check`
                  : fields.length > 0 && allDecided
                    ? 'Ready'
                    : 'Looks solid'}
              </span>
            </span>
          </div>
          {callDateLabel || callDurationLabel ? (
            <p className="text-sm text-muted">
              {[callDateLabel, callDurationLabel].filter(Boolean).join(' · ')}
            </p>
          ) : null}
        </section>

        {/* THE EVIDENCE: the call itself. Pinned, because every field tap
            scrubs this exact element. */}
        <section className="flex flex-col rounded-2xl border border-rule bg-surface">
          {audio?.url ? (
            <div className="border-b border-rule p-3">
              <audio ref={audioRef} controls src={audio.url} className="w-full" preload="metadata" />
            </div>
          ) : null}

          {transcriptText ? (
            <div className="p-3">
              <p className="mb-2 text-sm font-medium text-muted">Transcript</p>
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
                  <p className="whitespace-pre-wrap text-ink">{transcriptText}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="p-3 text-sm text-muted">
              No transcript on this extraction. Review the fields below on their own.
            </p>
          )}
        </section>

        {/* FIELD DECISIONS. Low-confidence first — the ones that need a person
            are the ones a person sees first. */}
        <div className="flex flex-col gap-2.5">
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
        <div className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm text-ledger-red">
          <p className="font-semibold">
            {clearAttempts.length} field{clearAttempts.length === 1 ? '' : 's'} can&apos;t be
            cleared this way.
          </p>
          <p className="mt-0.5">
            A blank field keeps the existing value. Type a replacement for each flagged field.
          </p>
        </div>
      ) : null}

      {summaryOpen ? (
        <CommitSummary fields={fields} decisions={decisions} values={values} />
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/40 bg-red-tint px-3.5 py-3 text-sm font-medium text-ledger-red"
        >
          {error}
        </p>
      ) : null}

      {/* The screen's ONE primary: commit. The two-step (a summary of what
          changes, then the commit) is kept — this is the only path from AI
          output into guest data, and `delivery_proofs`-style irreversibility
          rules do not apply here but a wrong commit is still a data edit. */}
      <BottomBar
        summary={
          unresolved.length > 0
            ? `${unresolved.length} of ${fields.length} still need a decision`
            : clearAttempts.length > 0
              ? 'Fix the flagged fields before committing'
              : 'Every field decided'
        }
        secondary={summaryOpen ? { label: 'Keep reviewing', onPress: () => setSummaryOpen(false) } : undefined}
        primary={
          summaryOpen
            ? {
                label: 'Commit',
                onPress: () => void handleCommit(),
                disabled: !canCommit || pendingAction !== null,
              }
            : {
                label: 'Review & commit',
                onPress: () => setSummaryOpen(true),
                disabled: !canCommit || pendingAction !== null,
              }
        }
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * One transcript turn.
 *
 * The speaker label is small sans, not a tracked monospace capital: the v3
 * look deletes uppercase mono eyebrows outright, and the colour already
 * separates the two speakers at a glance.
 */
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
      className={cn('rounded-lg px-2 py-1', isSelected && 'bg-brand-tint ring-1 ring-brand/40')}
    >
      <span className={cn('text-xs font-medium', isGuest ? 'text-ledger-green' : 'text-muted')}>
        {isGuest ? 'Guest' : 'Staff'}
      </span>
      <p className={cn('text-ink', isGuest && 'text-ledger-green-strong')}>{segment.text}</p>
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

/**
 * One extracted field as three chips and a value.
 *
 * WHY CHIPS AND NOT BUTTONS. The v2 panel gave every field a maroon "Accept"
 * button, so a 16-field extraction put 16 maroon commits on one screen and
 * the actual commit — the one that writes guest data — was indistinguishable
 * from the 16 taps that only set local state. Here the field controls are
 * chips (a choice), and the screen keeps its single maroon primary for the
 * commit. Decision state is still visible: the chip that is on carries its
 * tone, and the row says the word again next to a dot.
 */
function FieldDecisionRow({
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
}: FieldRowProps) {
  const meta = decision ? DECISION_META[decision] : null
  const low = confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD

  return (
    <div
      className={cn(
        'rounded-2xl border bg-surface',
        isLow ? 'border-ledger-red/35' : 'border-rule',
        decision && meta?.tone === 'done' && 'border-ledger-green/35',
      )}
      aria-label={isLow ? `${field.label}, low confidence` : field.label}
    >
      <div className="flex items-start gap-2.5 px-4 pt-3">
        {/* The margin rule: low-confidence fields break into the register's
            leading edge. This is the ledger-red = attention rule, and it is
            what makes a column of rows scannable for the one that needs eyes. */}
        <div
          aria-hidden
          className={cn('w-1 shrink-0 self-stretch rounded-full', isLow ? 'bg-ledger-red' : 'bg-transparent')}
        />

        <button
          type="button"
          onClick={onFocusEvidence}
          className="tap flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-1 py-0.5 text-left hover:bg-surface-2"
          title={evidenceStartMs != null ? 'Tap to hear the evidence' : undefined}
        >
          <span className="text-sm leading-snug text-muted">{field.label}</span>
          <span
            className={cn(
              'max-w-full text-base leading-snug font-medium break-words',
              decision === 'rejected' ? 'text-muted line-through' : 'text-ink',
            )}
          >
            {value || '—'}
          </span>
          {evidenceStartMs != null ? (
            <span className="text-xs text-subtle">
              {formatEvidenceMs(evidenceStartMs)}
              {evidenceEndMs != null ? `–${formatEvidenceMs(evidenceEndMs)}` : ''} · tap to hear
            </span>
          ) : null}
        </button>

        <span className="flex shrink-0 flex-col items-end gap-1 pt-0.5">
          {confidence !== null ? (
            <span
              className={cn(
                'figure text-sm font-medium tabular-nums',
                low ? 'text-ledger-red' : 'text-muted',
              )}
            >
              {Math.round(confidence * 100)}%
            </span>
          ) : null}
          {decision && meta ? (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={cn('h-2 w-2 rounded-full', DOT_TONE[DECISION_DOT[decision]])} />
              <span className="text-xs font-medium text-muted">{meta.label}</span>
            </span>
          ) : null}
        </span>
      </div>

      {editing ? (
        <div className="border-t border-rule px-4 py-3">
          <FieldEditor field={field} value={value} onChange={onChange} />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 px-3 pt-2 pb-3">
        <Chip
          selected={decision === 'accepted'}
          tone="done"
          disabled={editing}
          onClick={() => onDecide('accepted')}
        >
          Accept
        </Chip>
        <Chip
          selected={decision === 'edited'}
          tone="active"
          disabled={decision === 'rejected'}
          onClick={onEdit}
        >
          {editing ? 'Done' : 'Edit'}
        </Chip>
        <Chip
          selected={decision === 'rejected'}
          tone="attention"
          disabled={editing}
          onClick={() => onDecide('rejected')}
        >
          Reject
        </Chip>
      </div>
    </div>
  )
}

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

/**
 * What the commit will actually change.
 *
 * Rejected fields are shown struck through — a reviewer who rejected nine
 * fields and accepted one needs to see, before the write, that the eight they
 * were unsure about are going to be left alone rather than overwritten.
 */
function CommitSummary({
  fields,
  decisions,
  values,
}: {
  fields: ReviewFieldDef[]
  decisions: Record<string, Decision>
  values: ReviewFormValues
}) {
  const changed = fields.filter((f) => {
    const d = decisions[f.path]
    return d === 'edited' || d === 'rejected'
  })

  return (
    <div className="rounded-2xl border border-rule bg-surface p-4">
      <p className="mb-2 text-sm font-medium text-muted">What will change</p>
      <ul className="flex flex-col gap-1.5">
        {changed.length === 0 ? (
          <li className="text-sm text-muted">Nothing — the AI values are going in as-is.</li>
        ) : (
          changed.map((f) => (
            <li key={f.path} className="flex items-start gap-2 text-sm">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
              <span className="text-ink">
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
      <p className="mt-3 text-xs text-subtle">
        Recorded. Not reversible from here.
      </p>
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
