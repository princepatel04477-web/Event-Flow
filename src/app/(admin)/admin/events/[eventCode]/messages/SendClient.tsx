'use client'

import { useState, useEffect, useCallback } from 'react'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { LinkButton } from '@/components/ui/LinkButton'
import { Spinner } from '@/components/ui/Spinner'
import { ShieldAlertIcon } from '@/components/icons'
import {
  readTemplates,
  resolveRecipients,
  sendMessages,
  type MessageTemplate,
  type RecipientGroup,
  type RecipientFilter,
  type SendResult,
} from '@/lib/actions/messages'
import { lostResponseMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
  eventCode: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'setup'; templates: MessageTemplate[] }
  | { stage: 'preview'; template: MessageTemplate; recipients: RecipientGroup[]; filter: RecipientFilter; overwrite: boolean }
  | { stage: 'sending' }
  | { stage: 'result'; result: SendResult }
  | { stage: 'error'; message: string }

const FILTER_LABELS: Record<RecipientFilter, string> = {
  all_confirmed: 'All confirmed',
  arriving_today: 'Arriving today',
  departing_today: 'Departing today',
  room_allocated: 'Room allocated',
  no_room: 'No room yet',
}

export function SendClient({ eventId, eventCode }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<RecipientFilter>('all_confirmed')
  const [overwrite, setOverwrite] = useState(false)
  const [testMode, setTestMode] = useState(false)
  const [testNumber, setTestNumber] = useState('')

  const load = useCallback(async () => {
    setPhase({ stage: 'loading' })
    try {
      const templates = await readTemplates(eventId)
      if (templates.length === 0) {
        setPhase({ stage: 'error', message: 'No templates found. Run the seed migration first.' })
        return
      }
      setPhase({ stage: 'setup', templates })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load templates.' })
    }
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

  const handlePreview = async () => {
    if (!selectedTemplate) return
    setPhase({ stage: 'loading' })
    try {
      const template = (phase as { stage: 'setup'; templates: MessageTemplate[] }).templates.find(
        (t) => t.key === selectedTemplate,
      )!
      const recipients = await resolveRecipients(eventId, selectedFilter)
      setPhase({ stage: 'preview', template, recipients, filter: selectedFilter, overwrite })
    } catch {
      setPhase({ stage: 'error', message: 'Could not resolve recipients.' })
    }
  }

  const handleSend = async () => {
    if (phase.stage !== 'preview') return
    setPhase({ stage: 'sending' })
    // Both paths leave 'sending', so there is no pending flag to clear in a
    // `finally` — but the catch is not optional: a dropped connection makes the
    // action REJECT, and the screen used to sit on the "Sending messages…"
    // spinner for good with no way back. Some of the batch may have gone out,
    // so the sentence says so and points at the log.
    try {
      const result = await sendMessages(
        eventId,
        phase.template.key,
        phase.filter,
        testMode,
        testMode ? testNumber : undefined,
        phase.overwrite,
      )
      setPhase({ stage: 'result', result })
    } catch {
      setPhase({ stage: 'error', message: lostResponseMessage('the message log') })
    }
  }

  if (phase.stage === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  if (phase.stage === 'error') {
    return (
      <EmptyState
        icon={<ShieldAlertIcon className="h-7 w-7" />}
        title="Error"
        description={phase.message}
        action={<Button onClick={load}>Retry</Button>}
      />
    )
  }

  if (phase.stage === 'setup') {
    return (
      <div className="flex flex-col gap-5">
        <AdminPageTitle>Send messages</AdminPageTitle>

        {/* Template picker */}
        <div className="flex flex-col gap-2">
          <h2 className="eyebrow">Template</h2>
          <div className="flex flex-col gap-2">
            {phase.templates.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelectedTemplate(t.key)}
                aria-pressed={selectedTemplate === t.key}
                className={cn(
                  'tap w-full rounded-xl border px-4 py-3 text-left',
                  'transition-colors duration-press ease-ledger',
                  selectedTemplate === t.key
                    ? 'border-brand bg-brand-tint'
                    : 'border-rule bg-surface hover:bg-surface-2',
                )}
              >
                <p className="font-semibold text-ink">{t.key}</p>
                <p className="text-xs text-muted">{t.category ?? 'No category'}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Filter picker */}
        <div className="flex flex-col gap-2">
          <h2 className="eyebrow">Recipients</h2>
          <div className="flex flex-wrap gap-2">
            {(Object.entries(FILTER_LABELS) as [RecipientFilter, string][]).map(([value, label]) => (
              <Chip
                key={value}
                selected={selectedFilter === value}
                onClick={() => setSelectedFilter(value)}
              >
                {label}
              </Chip>
            ))}
          </div>
        </div>

        {/* Test mode */}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
            className="h-5 w-5 rounded accent-brand"
          />
          <span className="text-sm text-ink">Test mode — send to one number only</span>
        </label>

        {testMode && (
          <input
            type="tel"
            value={testNumber}
            onChange={(e) => setTestNumber(e.target.value)}
            placeholder="+919876543210"
            className="code-figure min-h-14 w-full rounded-xl border border-rule-strong bg-surface px-4 text-base text-ink placeholder:text-subtle"
          />
        )}

        <Button fullWidth onClick={handlePreview} disabled={!selectedTemplate}>
          Preview
        </Button>

        <LinkButton
          fullWidth
          variant="ghost"
          href={`/admin/events/${eventCode}/messages/log`}
        >
          View message log
        </LinkButton>
      </div>
    )
  }

  if (phase.stage === 'preview') {
    const { template, recipients, filter } = phase

    return (
      <div className="flex flex-col gap-4">
        <AdminPageTitle
          context={`${template.key} · ${FILTER_LABELS[filter]}`}
          actions={<span className="figure text-sm text-muted">{recipients.length}</span>}
        >
          Confirm send
        </AdminPageTitle>

        {/* Body preview */}
        <Card>
          <CardBody>
            <h3 className="eyebrow mb-2">Message preview</h3>
            <div className="rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
              {template.body}
            </div>
          </CardBody>
        </Card>

        {/* Recipient list */}
        <div className="max-h-64 overflow-y-auto">
          <h3 className="eyebrow mb-2">Recipients</h3>
          <div className="flex flex-col gap-1">
            {recipients.slice(0, 50).map((r) => (
              <div
                key={r.groupId || r.mobileNumber}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-2 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate text-ink">{r.headName}</span>
                <span className="code-figure shrink-0 text-xs text-muted">{r.mobileNumber}</span>
              </div>
            ))}
            {recipients.length > 50 && (
              <p className="text-center text-xs text-muted">
                + <span className="figure">{recipients.length - 50}</span> more
              </p>
            )}
          </div>
        </div>

        {/* Overwrite guard */}
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="h-5 w-5 rounded accent-brand"
          />
          <span className="text-sm text-ink">
            Re-send to groups that already received this template
          </span>
        </label>

        <div className="flex gap-3">
          <Button fullWidth variant="danger" onClick={handleSend}>
            Send to {recipients.length} families
          </Button>
          <Button fullWidth variant="secondary" onClick={() => void load()}>
            Back
          </Button>
        </div>

        <LinkButton
          fullWidth
          variant="ghost"
          href={`/admin/events/${eventCode}/messages/log`}
        >
          View message log
        </LinkButton>
      </div>
    )
  }

  if (phase.stage === 'sending') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <Spinner size="lg" />
        <p className="text-sm text-muted">Sending messages…</p>
      </div>
    )
  }

  if (phase.stage === 'result') {
    const { result } = phase
    return (
      <div className="flex flex-col gap-4">
        <AdminPageTitle>Send complete</AdminPageTitle>

        <Card>
          <CardBody>
            <div className="flex gap-6 text-center">
              <div>
                <p className="figure text-2xl font-medium text-ledger-green">{result.sent}</p>
                <p className="text-xs text-muted">sent</p>
              </div>
              <div>
                <p className="figure text-2xl font-medium text-ledger-red">{result.failed}</p>
                <p className="text-xs text-muted">failed</p>
              </div>
              <div>
                <p className="figure text-2xl font-medium text-muted">{result.skipped}</p>
                <p className="text-xs text-muted">skipped</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {result.errors.length > 0 && (
          <Card>
            <CardBody>
              <h3 className="mb-2 text-sm font-semibold text-ledger-red">Errors</h3>
              <ul className="flex flex-col gap-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-sm text-ledger-red">{e}</li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}

        <Button fullWidth onClick={() => load()}>
          Send more
        </Button>

        <LinkButton
          fullWidth
          variant="ghost"
          href={`/admin/events/${eventCode}/messages/log`}
        >
          View message log
        </LinkButton>
      </div>
    )
  }

  return null
}

export default SendClient
