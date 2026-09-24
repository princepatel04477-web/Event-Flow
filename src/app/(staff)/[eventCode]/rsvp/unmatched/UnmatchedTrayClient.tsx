'use client'

import { useCallback, useEffect, useState } from 'react'

import { BottomSheet } from '@/components/ui/BottomSheet'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Row } from '@/components/ui/Row'
import { Select } from '@/components/ui/Select'
import { MicIcon } from '@/components/icons'
import { formatDateTime } from '@/lib/utils'
import { formatMobile } from '@/lib/phone'
import { getLedgerEntries, markMatched } from '@/lib/harvest-ledger'
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

/**
 * Recordings the auto-match could not place, one row each, one sheet to fix.
 *
 * WHY A SHEET AND NOT A CARD PER FILE. The v2 tray put a family picker, a
 * retry button and an attach button on every card, so a tray of eight
 * recordings was 24 controls long and the floor never reached the ones at the
 * bottom. The list is now scannable (how many are there, how old), and the
 * work happens one file at a time in a sheet with the screen's single primary.
 *
 * EVERYTHING UNDERNEATH IS UNCHANGED: the same `getLedgerEntries` read, the
 * same `matchRecording` retry, the same `markMatched` write with the
 * `manual:<groupId>` sentinel. This screen is presentation only.
 */
export function UnmatchedTrayClient({
  eventId,
  groups,
}: {
  eventId: string
  /** Kept on the props: the route passes it and the ledger may need it again. */
  eventCode: string
  groups: Group[]
}) {
  const [entries, setEntries] = useState<UnmatchedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [openPath, setOpenPath] = useState<string | null>(null)
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

  useEffect(() => {
    void load()
  }, [load])

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
        setOpenPath(null)
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
      setOpenPath(null)
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
      label: `${g.head_name}${g.primary_mobile ? ` · ${formatMobile(g.primary_mobile)}` : ''}`,
    })),
  ]

  const openEntry = entries.find((e) => e.path === openPath) ?? null

  return (
    <div className="flex flex-col gap-4 pb-nav">
      <p className="text-sm text-muted">
        {loading
          ? 'Loading…'
          : entries.length === 0
            ? 'Nothing to fix.'
            : `${entries.length} recording${entries.length === 1 ? '' : 's'} with no family.`}
      </p>

      {error ? (
        <p role="alert" className="text-sm font-medium text-ledger-red">
          {error}
        </p>
      ) : null}

      {!loading && entries.length === 0 ? (
        <EmptyState
          icon={<MicIcon className="h-7 w-7" />}
          title="Every recording has a family"
          description="Everything detected was matched automatically."
        />
      ) : null}

      {entries.length > 0 ? (
        <ul
          className="flex flex-col overflow-hidden rounded-2xl border border-rule bg-surface"
          role="list"
        >
          {entries.map((entry) => {
            const failure = retryErrors.get(entry.path)
            return (
              <li key={entry.path}>
                <Row
                  heading={entry.name}
                  meta={
                    failure
                      ? failure.split('\n')[0]
                      : `Detected ${formatDateTime(new Date(entry.firstSeenAt).toISOString())}`
                  }
                  badge={
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-tint text-ledger-amber">
                      <MicIcon className="h-5 w-5" />
                    </span>
                  }
                  status="Unmatched"
                  tone="waiting"
                  onPress={() => setOpenPath(entry.path)}
                />
              </li>
            )
          })}
        </ul>
      ) : null}

      <BottomSheet
        open={openEntry !== null}
        onClose={() => setOpenPath(null)}
        label={openEntry ? `Attach ${openEntry.name}` : 'Attach recording'}
      >
        {openEntry ? (
          <div className="flex flex-col gap-4 pb-2">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm text-ink">{openEntry.name}</p>
              <p className="mt-0.5 text-sm text-muted">
                Detected {formatDateTime(new Date(openEntry.firstSeenAt).toISOString())}
              </p>
            </div>

            {retryErrors.get(openEntry.path) ? (
              <p role="alert" className="text-sm font-medium text-ledger-red">
                {retryErrors.get(openEntry.path)}
              </p>
            ) : null}

            <Select
              label="Family"
              value={selectedGroup.get(openEntry.path) ?? ''}
              onChange={(e) =>
                setSelectedGroup((prev) => new Map(prev).set(openEntry.path, e.target.value))
              }
              options={groupOptions}
              placeholder="Pick a family…"
            />

            <Button
              variant="primary"
              fullWidth
              disabled={!selectedGroup.get(openEntry.path)}
              loading={attaching === openEntry.path}
              onClick={() => void handleManualAttach(openEntry.path)}
            >
              Attach to this family
            </Button>

            <Button
              variant="secondary"
              fullWidth
              onClick={() => void handleRetryMatch(openEntry.path)}
            >
              Try auto-match again
            </Button>
          </div>
        ) : null}
      </BottomSheet>
    </div>
  )
}

export default UnmatchedTrayClient
