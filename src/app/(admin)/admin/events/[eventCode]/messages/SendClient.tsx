'use client'

import { useState, useEffect, useCallback } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { LinkButton } from '@/components/ui/LinkButton'
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
    const result = await sendMessages(
      eventId,
      phase.template.key,
      phase.filter,
      testMode,
      testMode ? testNumber : undefined,
      phase.overwrite,
    )
    setPhase({ stage: 'result', result })
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
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-fg">Send messages</h2>
          <p className="mt-0.5 text-sm text-muted">
            Pick a template and a recipient set. Preview before sending.
          </p>
        </div>

        {/* Template picker */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Template</h3>
          <div className="flex flex-col gap-2">
            {phase.templates.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setSelectedTemplate(t.key)}
                className={cn(
                  'tap w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  selectedTemplate === t.key
                    ? 'border-brand bg-tint-info text-brand'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <p className="font-semibold text-fg">{t.key}</p>
                <p className="text-xs text-muted">{t.category ?? 'No category'}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Filter picker */}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-fg">Recipients</h3>
          <div className="flex flex-col gap-2">
            {(Object.entries(FILTER_LABELS) as [RecipientFilter, string][]).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setSelectedFilter(value)}
                className={cn(
                  'tap w-full rounded-xl border px-4 py-3 text-left transition-colors',
                  selectedFilter === value
                    ? 'border-brand bg-tint-info text-brand'
                    : 'border-border bg-surface hover:bg-surface-2',
                )}
              >
                <p className="font-semibold text-fg">{label}</p>
              </button>
            ))}
          </div>
        </div>

        {/* Test mode */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={testMode}
            onChange={(e) => setTestMode(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm text-fg">Test mode — send only to one number</span>
        </label>

        {testMode && (
          <input
            type="tel"
            value={testNumber}
            onChange={(e) => setTestNumber(e.target.value)}
            placeholder="+919876543210"
            className="w-full rounded-xl border border-border bg-surface px-4 py-3 text-base text-fg placeholder:text-subtle"
          />
        )}

        <Button
          fullWidth
          size="lg"
          onClick={handlePreview}
          disabled={!selectedTemplate}
        >
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
        <div>
          <h2 className="text-xl font-semibold text-fg">Confirm send</h2>
          <p className="mt-0.5 text-sm text-muted">
            Template: <span className="font-semibold text-fg">{template.key}</span>
            {' · '}
            {FILTER_LABELS[filter]}
          </p>
        </div>

        {/* Recipient count */}
        <Card>
          <CardBody className="text-center">
            <p className="text-3xl font-bold tabular-nums text-fg">
              {recipients.length}
            </p>
            <p className="mt-1 text-sm text-muted">
              recipient{recipients.length !== 1 ? 's' : ''}
            </p>
          </CardBody>
        </Card>

        {/* Body preview */}
        <Card>
          <CardBody>
            <h3 className="mb-2 text-sm font-semibold text-fg">Message preview</h3>
            <div className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm text-fg whitespace-pre-wrap">
              {template.body}
            </div>
          </CardBody>
        </Card>

        {/* Recipient list */}
        <div className="max-h-64 overflow-y-auto">
          <h3 className="mb-2 text-sm font-semibold text-fg">Recipients</h3>
          <div className="flex flex-col gap-1">
            {recipients.slice(0, 50).map((r) => (
              <div
                key={r.groupId || r.mobileNumber}
                className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-1.5 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">{r.headName}</span>
                <span className="shrink-0 text-xs text-muted">{r.mobileNumber}</span>
              </div>
            ))}
            {recipients.length > 50 && (
              <p className="text-center text-xs text-muted">
                + {recipients.length - 50} more
              </p>
            )}
          </div>
        </div>

        {/* Overwrite guard */}
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(e) => setOverwrite(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm text-fg">Send to groups that already received this template</span>
        </label>

        <div className="flex gap-3">
          <Button fullWidth variant="danger" size="lg" onClick={handleSend}>
            Send to {recipients.length} families
          </Button>
          <Button
            fullWidth
            variant="ghost"
            onClick={() => void load()}
          >
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
        <div>
          <h2 className="text-xl font-semibold text-fg">Send complete</h2>
        </div>

        <Card>
          <CardBody>
            <div className="flex gap-6 text-center">
              <div>
                <p className="text-2xl font-bold tabular-nums text-success">{result.sent}</p>
                <p className="text-xs text-muted">sent</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-danger">{result.failed}</p>
                <p className="text-xs text-muted">failed</p>
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums text-muted">{result.skipped}</p>
                <p className="text-xs text-muted">skipped</p>
              </div>
            </div>
          </CardBody>
        </Card>

        {result.errors.length > 0 && (
          <Card>
            <CardBody>
              <h3 className="mb-2 text-sm font-semibold text-danger">Errors</h3>
              <ul className="flex flex-col gap-1">
                {result.errors.map((e, i) => (
                  <li key={i} className="text-sm text-danger">{e}</li>
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
