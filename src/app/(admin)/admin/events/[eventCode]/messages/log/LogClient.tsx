'use client'

import { useState, useEffect, useCallback } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { ShieldAlertIcon } from '@/components/icons'
import {
  readMessageLog,
  retryMessage,
  type MessageLogRow,
  type MessageLogFilter,
} from '@/lib/actions/messages'
import { cn } from '@/lib/utils'

interface Props {
  eventId: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; rows: MessageLogRow[]; actionError: string | null }
  | { stage: 'error'; message: string }

const STATUS_META: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' | 'info' }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'info' },
  delivered: { label: 'Delivered', tone: 'success' },
  read: { label: 'Read', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
}

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
      <div>
        <h2 className="text-xl font-semibold text-fg">Message log</h2>
        <p className="mt-0.5 text-sm text-muted">
          Status updates from the provider webhook.
        </p>
      </div>

      {actionError && (
        <div className="rounded-xl border border-tint-danger bg-tint-danger px-4 py-3 text-sm text-danger">
          {actionError}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'sent', 'delivered', 'failed', 'queued'] as MessageLogFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { setFilter(f); load(f) }}
            className={cn(
              'tap rounded-full px-3 py-1.5 text-sm font-semibold transition-colors',
              filter === f
                ? 'bg-brand text-brand-fg'
                : 'bg-surface-2 text-muted hover:text-fg',
            )}
          >
            {f === 'all' ? 'All' : STATUS_META[f]?.label ?? f}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">No messages yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => {
            const meta = STATUS_META[r.status] ?? STATUS_META.queued
            return (
              <Card key={r.id}>
                <CardBody>
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-medium text-fg truncate">
                          {r.headName ?? r.toNumber}
                        </span>
                        <Badge tone={meta.tone} size="sm">{meta.label}</Badge>
                      </div>
                      <p className="text-xs text-muted">
                        {r.templateKey}
                        {r.queuedAt ? ` · ${new Date(r.queuedAt).toLocaleString()}` : ''}
                      </p>
                      {r.error && (
                        <p className="mt-1 text-xs text-danger">{r.error}</p>
                      )}
                      {r.providerMessageId && (
                        <p className="text-xs text-subtle mt-0.5">
                          ID: {r.providerMessageId}
                        </p>
                      )}
                    </div>

                    {r.status === 'failed' && (
                      <button
                        type="button"
                        disabled={retrying === r.id}
                        onClick={() => handleRetry(r.id)}
                        className="tap shrink-0 rounded-lg px-2 py-1 text-xs text-muted hover:text-fg disabled:opacity-55"
                      >
                        {retrying === r.id ? '…' : 'Retry'}
                      </button>
                    )}
                  </div>
                </CardBody>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
