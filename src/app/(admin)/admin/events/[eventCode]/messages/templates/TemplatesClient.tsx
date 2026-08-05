'use client'

import { useState, useEffect, useCallback } from 'react'

import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { FileTextIcon, ShieldAlertIcon } from '@/components/icons'
import {
  readTemplates,
  type MessageTemplate,
} from '@/lib/actions/messages'

interface Props {
  eventId: string
}

type Phase =
  | { stage: 'loading' }
  | { stage: 'ready'; templates: MessageTemplate[]; preview: { body: string; missing: string[] } | null }
  | { stage: 'error'; message: string }

export function TemplatesClient({ eventId }: Props) {
  const [phase, setPhase] = useState<Phase>({ stage: 'loading' })
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setPhase({ stage: 'loading' })
    try {
      const templates = await readTemplates(eventId)
      setPhase({ stage: 'ready', templates, preview: null })
    } catch {
      setPhase({ stage: 'error', message: 'Could not load templates.' })
    }
  }, [eventId])

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load() }, [load])

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
        title="Could not load templates"
        description={phase.message}
        action={<Button onClick={load}>Retry</Button>}
      />
    )
  }

  const { templates } = phase

  if (templates.length === 0) {
    return (
      <EmptyState
        icon={<FileTextIcon className="h-7 w-7" />}
        title="No templates"
        description="Seed templates are loaded from the database. If this is empty, run the seed migration."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold text-fg">Message templates</h2>
        <p className="mt-0.5 text-sm text-muted">
          Global templates with optional event-level overrides.
          Variables use {'{{double curly}}'} syntax.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {templates.map((t) => (
          <Card key={t.key}>
            <button
              type="button"
              onClick={() => setExpandedKey(expandedKey === t.key ? null : t.key)}
              className="tap w-full text-left"
            >
              <CardHeader>
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold text-fg">{t.key}</h3>
                  <p className="text-xs text-muted">
                    {t.category ? `${t.category} · ` : ''}{t.language}
                  </p>
                </div>
                <Badge tone={t.isActive ? 'success' : 'neutral'} size="sm">
                  {t.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </CardHeader>
            </button>

            {expandedKey === t.key && (
              <CardBody className="border-t border-border pt-4">
                <div className="mb-3 rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm text-fg whitespace-pre-wrap">
                  {t.body}
                </div>

                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {t.variables.map((v) => (
                      <Badge key={v} tone="info" size="sm">
                        {v}
                      </Badge>
                    ))}
                  </div>
                )}

                <p className="mt-3 text-xs text-muted">
                  Templates need BSP approval before they can be sent.
                  Approval status is tracked in the provider dashboard.
                </p>
              </CardBody>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
