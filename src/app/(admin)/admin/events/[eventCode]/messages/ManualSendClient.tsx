'use client'

import { useState, useEffect, useCallback } from 'react'
import * as XLSX from 'xlsx'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { LinkButton } from '@/components/ui/LinkButton'
import { CopyIcon, DownloadIcon, ShieldAlertIcon } from '@/components/icons'
import {
  readTemplates,
  resolveRecipients,
  generateMessages,
  type MessageTemplate,
  type RecipientFilter,
  type GeneratedMessage,
} from '@/lib/actions/messages'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
  eventCode: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'setup'; templates: MessageTemplate[] }
  | { stage: 'preview'; template: MessageTemplate; messages: GeneratedMessage[]; filter: RecipientFilter }
  | { stage: 'copied'; label: string }
  | { stage: 'error'; message: string }

const FILTER_LABELS: Record<RecipientFilter, string> = {
  all_confirmed: 'All confirmed',
  arriving_today: 'Arriving today',
  departing_today: 'Departing today',
  room_allocated: 'Room allocated',
  no_room: 'No room yet',
}

export function ManualSendClient({ eventId, eventCode }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [selectedFilter, setSelectedFilter] = useState<RecipientFilter>('all_confirmed')

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

  const handleGenerate = async () => {
    if (!selectedTemplate) return
    setPhase({ stage: 'loading' })
    try {
      const template = (phase as { stage: 'setup'; templates: MessageTemplate[] }).templates.find(
        (t) => t.key === selectedTemplate,
      )!
      const messages = await generateMessages(eventId, selectedTemplate, selectedFilter)
      setPhase({ stage: 'preview', template, messages, filter: selectedFilter })
    } catch {
      setPhase({ stage: 'error', message: 'Could not generate messages.' })
    }
  }

  const handleCopyOne = async (msg: GeneratedMessage) => {
    await navigator.clipboard.writeText(msg.body)
    if (phase.stage !== 'preview') return
    // Flash a brief copied state then return to preview
    const prev = phase
    setPhase({ stage: 'copied', label: msg.headName })
    setTimeout(() => {
      setPhase(prev)
    }, 1500)
  }

  const handleCopyAll = async () => {
    if (phase.stage !== 'preview') return
    const text = phase.messages
      .map((m) => `${m.mobileNumber}\n${m.body}`)
      .join('\n\n---\n\n')
    await navigator.clipboard.writeText(text)
    const prev = phase
    setPhase({ stage: 'copied', label: `All ${phase.messages.length} messages` })
    setTimeout(() => {
      setPhase(prev)
    }, 2000)
  }

  const handleExport = () => {
    if (phase.stage !== 'preview') return
    const rows = phase.messages.map((m) => ({
      Mobile: m.mobileNumber,
      Family: m.headName,
      Message: m.body,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 16 }, { wch: 20 }, { wch: 60 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Messages')
    XLSX.writeFile(wb, `${eventCode}_${phase.template.key}_messages.xlsx`)
  }

  // Loading
  if (phase.stage === 'loading') {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner size="md" />
      </div>
    )
  }

  // Error
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

  // Copied toast
  if (phase.stage === 'copied') {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
        <p className="text-sm text-success font-semibold">Copied: {phase.label}</p>
        <Button onClick={() => {}} variant="ghost" fullWidth>
          {/* This re-renders via the timeout above — just a visual placeholder */}
        </Button>
      </div>
    )
  }

  // Setup: pick template + filter
  if (phase.stage === 'setup') {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-fg">Prepare messages</h2>
          <p className="mt-0.5 text-sm text-muted">
            Pick a template, pick a filter. Messages are saved as queued but never sent — you copy them manually.
          </p>
        </div>

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

        <div className="flex gap-3">
          <Button fullWidth size="lg" onClick={handleGenerate} disabled={!selectedTemplate}>
            Generate messages
          </Button>
          <LinkButton fullWidth variant="ghost" href={`/${eventCode}`}>
            Back
          </LinkButton>
        </div>

        <LinkButton fullWidth variant="ghost" href={`/admin/events/${eventCode}/messages/log`}>
          View message log
        </LinkButton>
      </div>
    )
  }

  // Preview / result
  if (phase.stage === 'preview') {
    const { template, messages, filter } = phase

    return (
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-xl font-semibold text-fg">{messages.length} messages ready</h2>
          <p className="mt-0.5 text-sm text-muted">
            {template.key} · {FILTER_LABELS[filter]}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            fullWidth
            variant="secondary"
            leadingIcon={<CopyIcon className="h-4 w-4" />}
            onClick={handleCopyAll}
          >
            Copy all
          </Button>
          <Button
            fullWidth
            variant="secondary"
            leadingIcon={<DownloadIcon className="h-4 w-4" />}
            onClick={handleExport}
          >
            Export Excel
          </Button>
        </div>

        {/* Message list */}
        <div className="flex flex-col gap-2">
          {messages.map((m, i) => (
            <Card key={m.messageId || i}>
              <CardBody className="flex flex-col gap-2 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-fg">{m.headName}</span>
                    <Badge tone="neutral" size="sm">{m.mobileNumber}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    leadingIcon={<CopyIcon className="h-3.5 w-3.5" />}
                    onClick={() => handleCopyOne(m)}
                    aria-label={`Copy message for ${m.headName}`}
                  />
                </div>
                <div className="rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm text-fg whitespace-pre-wrap">
                  {m.body}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>

        <Button fullWidth variant="ghost" onClick={load}>
          Generate more
        </Button>
      </div>
    )
  }

  return null
}
