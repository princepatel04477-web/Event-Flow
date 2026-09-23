'use client'

import { useState, useEffect, useCallback } from 'react'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Row, type RowTone } from '@/components/ui/Row'
import { Spinner } from '@/components/ui/Spinner'
import { ShieldAlertIcon } from '@/components/icons'
import {
  readMessageLog,
  retryMessage,
  type MessageLogRow,
  type MessageLogFilter,
} from '@/lib/actions/messages'

interface Props {
  eventId: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; rows: MessageLogRow[]; actionError: string | null }
  | { stage: 'error'; message: string }

const STATUS_META: Record<string, { label: string; tone: RowTone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'neutral' },
  delivered: { label: 'Delivered', tone: 'done' },
  read: { label: 'Read', tone: 'done' },
  failed: { label: 'Failed', tone: 'problem' },
}

const LOG_FILTERS: MessageLogFilter[] = ['all', 'sent', 'delivered', 'failed', 'queued']

export function LogClient({ eventId }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [filter, setFilter] = useState<MessageLogFilter>('all')
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(async (f: MessageLogFilter) => {
    setPhase({ stage: 'loading' })
    try {
      const rows = await readMessageLog(eventId, f)
      setPhase({ stage: 'ready', rows, actionError: null })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load message log.' })
    }
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load('all') }, [load])

  const handleRetry = async (messageId: string) => {
    setRetrying(messageId)
    const result = await retryMessage(messageId)
    if (result.ok) {
      await load(filter)
    } else {
      setPhase((prev) =>
        prev.stage === 'ready'
          ? { ...prev, actionError: result.error ?? 'Retry failed.' }
          : prev,
      )
    }
    setRetrying(null)
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
        title="Could not load log"
        description={phase.message}
        action={<Button onClick={() => load(filter)}>Retry</Button>}
      />
    )
  }

  const { rows, actionError } = phase

  return (
    <div className="flex flex-col gap-4">
      <AdminPageTitle context="Status from the provider webhook">Message log</AdminPageTitle>

      {actionError ? (
        <p
          role="alert"
          className="rounded-xl border border-ledger-red/35 bg-red-tint px-4 py-3 text-sm font-medium text-ledger-red"
        >
          {actionError}
        </p>
      ) : null}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {LOG_FILTERS.map((f) => (
          <Chip
            key={f}
            selected={filter === f}
            onClick={() => { setFilter(f); void load(f) }}
          >
            {f === 'all' ? 'All' : STATUS_META[f]?.label ?? f}
          </Chip>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No messages yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.queued
            return (
              <li key={r.id}>
                <Card>
                  <Row
                    heading={r.headName ?? r.toNumber}
                    meta={`${r.templateKey}${r.queuedAt ? ` · ${new Date(r.queuedAt).toLocaleString()}` : ''}`}
                    status={meta.label}
                    tone={meta.tone}
                    trailing={
                      r.status === 'failed' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={retrying === r.id}
                          onClick={() => handleRetry(r.id)}
                        >
                          {retrying === r.id ? 'Retrying…' : 'Retry'}
                        </Button>
                      ) : undefined
                    }
                  />

                  {r.error ? (
                    <p className="px-3 py-2 text-xs text-ledger-red">{r.error}</p>
                  ) : null}

                  {r.providerMessageId ? (
                    <p className="px-3 py-2 text-xs text-subtle">
                      ID <span className="figure">{r.providerMessageId}</span>
                    </p>
                  ) : null}
                </Card>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default LogClient
