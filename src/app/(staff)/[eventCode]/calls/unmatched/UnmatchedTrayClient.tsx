'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { MicIcon } from '@/components/icons'
import { formatDateTime } from '@/lib/utils'
import { getLedgerEntries, markMatched, type HarvestLedgerEntry } from '@/lib/harvest-ledger'
import { matchRecording } from '@/lib/harvest-match'

interface Group {
  id: string
  head_name: string
  primary_mobile: string | null
}

interface UnmatchedFile {
  path: string
  name: string
  firstSeenAt: number
}

export function UnmatchedTrayClient({
  eventId,
  eventCode,
  groups,
}: {
  eventId: string
  eventCode: string
  groups: Group[]
}) {
  const [entries, setEntries] = useState<UnmatchedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [selectedGroup, setSelectedGroup] = useState<Map<string, string>>(new Map())
  const [retryErrors, setRetryErrors] = useState<Map<string, string>>(new Map())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const all = await getLedgerEntries({ status: 'unmatched' })
      setEntries(
        all.map((e) => ({
          path: e.path,
          name: e.path.split('/').pop() ?? e.path,
          firstSeenAt: e.firstSeenAt,
        })),
      )
    } catch {
      setError('Could not load the unmatched list.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function handleRetryMatch(filePath: string) {
    setRetryErrors((prev) => {
      const next = new Map(prev)
      next.delete(filePath)
      return next
    })

    try {
      // Guess duration from filename/timing — the plugin's getDuration() is
      // for real files; here we just need a match. Pass null for duration.
      const result = await matchRecording({
        filePath,
        fileSize: 0,
        fileMtime: Date.now(),
        durationSec: null,
        eventId,
      })

      if (result.kind === 'matched') {
        await markMatched(filePath, result.callAttemptId)
        await load()
        return
      }

      if (result.kind === 'error') {
        setRetryErrors((prev) => new Map(prev).set(filePath, result.message))
      }
      // 'unmatched' stays put — not an error.
    } catch (e) {
      setRetryErrors((prev) =>
        new Map(prev).set(filePath, e instanceof Error ? e.message : 'Unknown error'),
      )
    }
  }

  async function handleManualAttach(filePath: string) {
    const groupId = selectedGroup.get(filePath)
    if (!groupId) return

    setAttaching(filePath)
    try {
      // Manual attach: mark the ledger as matched to the selected group.
      // We don't have a call_attempt_id for a manual match, so we use a
      // sentinel that signals "manually attached to group X".
      await markMatched(filePath, `manual:${groupId}`)
      setSelectedGroup((prev) => {
        const next = new Map(prev)
        next.delete(filePath)
        return next
      })
      await load()
    } catch (e) {
      setRetryErrors((prev) =>
        new Map(prev).set(filePath, e instanceof Error ? e.message : 'Unknown error'),
      )
    } finally {
      setAttaching(null)
    }
  }

  const groupOptions = [
    { value: '', label: 'Pick a family…' },
    ...groups.map((g) => ({
      value: g.id,
      label: `${g.head_name}${g.primary_mobile ? ` · ${g.primary_mobile}` : ''}`,
    })),
  ]

  return (
    <div className="flex flex-col gap-4 pb-4">
      <h2 className="text-lg font-semibold text-fg">Unmatched recordings</h2>
      <p className="text-sm text-muted">
        These recordings were detected but could not be automatically matched to a call.
        Attach each one to the correct family or try re-matching.
      </p>

      {error ? (
        <p className="text-sm text-danger">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<MicIcon className="h-7 w-7" />}
          title="Nothing unmatched"
          description="Every detected recording was matched automatically."
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {entries.map((entry) => (
            <li key={entry.path}>
              <Card>
                <CardHeader>
                  <CardTitle>
                    <div className="flex items-center gap-2">
                      <MicIcon className="h-5 w-5 shrink-0 text-muted" />
                      <span className="truncate font-mono text-sm text-fg">{entry.name}</span>
                    </div>
                  </CardTitle>
                  <Badge tone="warning" size="sm">Unmatched</Badge>
                </CardHeader>
                <CardBody className="flex flex-col gap-2">
                  <p className="text-xs text-subtle truncate">{entry.path}</p>
                  <p className="text-xs text-muted">
                    Detected {formatDateTime(new Date(entry.firstSeenAt).toISOString())}
                  </p>

                  {retryErrors.get(entry.path) ? (
                    <p className="text-xs text-danger">{retryErrors.get(entry.path)}</p>
                  ) : null}

                  <div className="flex flex-col gap-2 mt-1">
                    <Select
                      label="Attach to"
                      value={selectedGroup.get(entry.path) ?? ''}
                      onChange={(e) =>
                        setSelectedGroup((prev) =>
                          new Map(prev).set(entry.path, e.target.value),
                        )
                      }
                      options={groupOptions}
                      placeholder="Pick a family…"
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="md"
                        fullWidth
                        onClick={() => handleRetryMatch(entry.path)}
                      >
                        Retry auto-match
                      </Button>
                      <Button
                        variant="primary"
                        size="md"
                        fullWidth
                        disabled={!selectedGroup.get(entry.path)}
                        loading={attaching === entry.path}
                        onClick={() => handleManualAttach(entry.path)}
                      >
                        Attach
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
