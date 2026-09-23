'use client'

import { useState, useEffect, useCallback } from 'react'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { FileTextIcon, ShieldAlertIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
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
        description="Run the seed migration to load the defaults."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <AdminPageTitle
        context={`${templates.length} template${templates.length === 1 ? '' : 's'} · variables in double curly braces`}
      >
        Message templates
      </AdminPageTitle>

      <div className="flex flex-col gap-3">
        {templates.map((t) => (
          <Card key={t.key}>
            <button
              type="button"
              onClick={() => setExpandedKey(expandedKey === t.key ? null : t.key)}
              aria-expanded={expandedKey === t.key}
              className="tap w-full text-left"
            >
              <CardHeader>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-semibold text-ink">{t.key}</h3>
                  <p className="truncate text-xs text-muted">
                    {t.category ? `${t.category} · ` : ''}{t.language}
                  </p>
                </div>
                {/* A status is a word with a dot beside it, not a pill. */}
                <span className="flex shrink-0 items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      'h-2.5 w-2.5 rounded-full',
                      t.isActive ? 'bg-ledger-green' : 'bg-subtle',
                    )}
                  />
                  <span className="text-sm font-medium text-muted">
                    {t.isActive ? 'Active' : 'Inactive'}
                  </span>
                </span>
              </CardHeader>
            </button>

            {expandedKey === t.key && (
              <CardBody className="border-t border-rule pt-4">
                <div className="mb-3 rounded-xl bg-surface-2 px-3 py-2 text-sm whitespace-pre-wrap text-ink">
                  {t.body}
                </div>

                {t.variables.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {t.variables.map((v) => (
                      <span
                        key={v}
                        className="code-figure inline-flex items-center rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted"
                      >
                        {v}
                      </span>
                    ))}
                  </div>
                )}

                <p className="mt-3 text-xs text-muted">
                  Needs BSP approval before it can be sent.
                </p>
              </CardBody>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

export default TemplatesClient
