'use client'

import { useCallback, useEffect, useState } from 'react'

import { AdminPageTitle } from '@/app/(admin)/AdminPageTitle'
import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Row, type RowTone } from '@/components/ui/Row'
import { cn } from '@/lib/utils'
import {
  hasPermission,
  requestPermission,
  discoverFolders,
  listFiles,
  getDuration,
  startWatching,
  stopWatching,
  onRecordingDetected,
  isHarvestAvailable,
} from '@/lib/harvest'
import {
  getLedgerEntries,
  type HarvestLedgerEntry,
} from '@/lib/harvest-ledger'
import {
  discoveredListings,
  listingView,
  type FolderListing,
} from '@/lib/harvest-listings'

interface DetectedLog {
  at: number
  path: string
  name: string
}

export function HarvestDebugClient() {
  const [granted, setGranted] = useState<boolean | null>(null)
  const [granting, setGranting] = useState(false)
  const [folders, setFolders] = useState<string[]>([])
  const [folderListings, setFolderListings] = useState<FolderListing[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detectedLog, setDetectedLog] = useState<DetectedLog[]>([])
  const [ledger, setLedger] = useState<HarvestLedgerEntry[]>([])
  const [durationResults, setDurationResults] = useState<Map<string, number | null>>(new Map())
  const [pluginAvailable, setPluginAvailable] = useState<boolean | null>(null)

  const checkPerm = useCallback(async () => {
    const ok = await hasPermission()
    setGranted(ok)
  }, [])

  useEffect(() => {
    setPluginAvailable(isHarvestAvailable())
    void checkPerm()
    // Cleanup observer on unmount
    return () => { void stopWatching() }
  }, [checkPerm])

  async function handleRequestPermission() {
    setGranting(true)
    setError(null)
    try {
      await requestPermission()
      // User returns from Settings — we re-check.
      await checkPerm()
    } catch (e) {
      setError(`Failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setGranting(false)
    }
  }

  async function handleDiscover() {
    setLoading(true)
    setError(null)
    try {
      const found = await discoverFolders()
      setFolders(found)
      // Found, not read. Each row starts unlisted — see `discoveredListing`.
      setFolderListings(discoveredListings(found))
    } catch (e) {
      setError(`Discover failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }

  async function handleListFolder(folderPath: string) {
    setFolderListings((prev) =>
      prev.map((f) => (f.path === folderPath ? { ...f, loading: true, error: undefined } : f)),
    )
    try {
      const files = await listFiles(folderPath)
      setFolderListings((prev) =>
        prev.map((f) =>
          f.path === folderPath ? { ...f, files, loading: false } : f,
        ),
      )
    } catch (e) {
      setFolderListings((prev) =>
        prev.map((f) =>
          f.path === folderPath
            ? { ...f, loading: false, error: e instanceof Error ? e.message : String(e) }
            : f,
        ),
      )
    }
  }

  async function handleWatch() {
    await startWatching(folders)
  }

  async function handleStopWatch() {
    await stopWatching()
  }

  useEffect(() => {
    return onRecordingDetected((event) => {
      setDetectedLog((prev) => [
        { at: Date.now(), path: event.path, name: event.name },
        ...prev,
      ].slice(0, 20))
    })
  }, [])

  async function handleLoadLedger() {
    const entries = await getLedgerEntries()
    setLedger(entries)
  }

  async function handleGetDuration(filePath: string) {
    const dur = await getDuration(filePath)
    setDurationResults((prev) => new Map(prev).set(filePath, dur))
  }

  const STATUS_TONES: Record<string, RowTone> = {
    seen: 'neutral',
    matched: 'done',
    uploaded: 'done',
    unmatched: 'waiting',
    failed: 'problem',
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <AdminPageTitle context="Device-level diagnostics">Harvest debug</AdminPageTitle>

      {/* Plugin status */}
      <Card>
        <CardHeader>
          <CardTitle>Plugin</CardTitle>
        </CardHeader>
        <CardBody>
          <StatusWord
            tone={pluginAvailable === null ? 'neutral' : pluginAvailable ? 'done' : 'problem'}
            label={
              pluginAvailable === null ? 'Checking…' : pluginAvailable ? 'Available' : 'Not available'
            }
          />
        </CardBody>
      </Card>

      {/* Permission */}
      <Card>
        <CardHeader>
          <CardTitle>Permission</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <StatusWord
            tone={granted === null ? 'neutral' : granted ? 'done' : 'waiting'}
            label={granted === null ? 'Checking…' : granted ? 'Granted' : 'Not granted'}
          />
          <div className="flex gap-2">
            <Button variant="secondary" onClick={checkPerm}>
              Check again
            </Button>
            <Button variant="primary" onClick={handleRequestPermission} loading={granting}>
              Open settings
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-ledger-red">
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>

      {/* Folders */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-3">
              Folders <span className="figure text-xs text-muted">{folders.length}</span>
              <Button variant="secondary" size="sm" onClick={handleDiscover} loading={loading}>
                Discover
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {folders.length === 0 ? (
            <p className="text-sm text-muted">No folders found. Grant permission and try Discover.</p>
          ) : (
            folders.map((folder) => {
              const listing = folderListings.find((f) => f.path === folder)
              const view = listingView(listing)
              return (
                <div key={folder} className="rounded-xl bg-surface-2 p-3">
                  <p className="mb-2 text-xs break-all text-subtle">{folder}</p>
                  <div className="mb-2 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" onClick={() => handleListFolder(folder)}>
                      List files
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handleWatch}>
                      Watch
                    </Button>
                    <Button variant="secondary" size="sm" onClick={handleStopWatch}>
                      Stop
                    </Button>
                  </div>
                  {/* One branch per honest state. "Loading…" is only ever
                      rendered while a `listFiles` call is actually in flight,
                      and an unlisted folder says so instead of implying it is
                      empty or still working. */}
                  {view.kind === 'loading' ? (
                    <p className="text-xs text-muted">Loading…</p>
                  ) : view.kind === 'error' ? (
                    <p className="text-xs text-ledger-red">{view.message}</p>
                  ) : view.kind === 'unlisted' ? (
                    <p className="text-xs text-muted">
                      Not listed yet. Press List files to read this folder.
                    </p>
                  ) : view.kind === 'empty' ? (
                    <p className="text-xs text-muted">Empty folder</p>
                  ) : (
                    <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
                      {view.files.map((f) => (
                        <li key={f.path} className="flex items-center gap-2 text-xs">
                          <span className="figure shrink-0 text-muted">
                            {durLabel(durationResults.get(f.path))}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-ink">{f.name}</span>
                          <span className="figure shrink-0 text-subtle">{formatBytes(f.size)}</span>
                          <span className="figure shrink-0 text-subtle">{formatAge(f.ageSec)}</span>
                          <Button variant="ghost" size="sm" onClick={() => handleGetDuration(f.path)}>
                            Duration
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })
          )}
        </CardBody>
      </Card>

      {/* Detected log */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-3">
              Detected <span className="figure text-xs text-muted">{detectedLog.length}</span>
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {detectedLog.length === 0 ? (
            <p className="text-sm text-muted">No events yet. Watch folders and place a call.</p>
          ) : (
            <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
              {detectedLog.map((d, i) => (
                <li key={i} className="text-xs text-ink">
                  <span className="figure text-subtle">
                    {new Date(d.at).toLocaleTimeString()}
                  </span>{' '}
                  {d.name}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {/* Ledger */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-3">
              Ledger <span className="figure text-xs text-muted">{ledger.length}</span>
              <Button variant="secondary" size="sm" onClick={handleLoadLedger}>
                Refresh
              </Button>
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted">Nothing tracked yet.</p>
          ) : (
            <ul className="-mx-4 -my-4 max-h-80 overflow-y-auto">
              {ledger.map((entry) => (
                <li key={entry.path} className="border-b border-rule last:border-b-0">
                  <Row
                    heading={entry.path.split('/').pop() ?? entry.path}
                    meta={entry.path}
                    status={entry.status}
                    tone={STATUS_TONES[entry.status] ?? 'neutral'}
                  />
                  {entry.lastError ? (
                    <p className="px-3 pb-2 text-xs text-ledger-red">{entry.lastError}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

/** A status is a word with a dot beside it — never a coloured pill. */
function StatusWord({ tone, label }: { tone: RowTone; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          'h-2.5 w-2.5 rounded-full',
          tone === 'done'
            ? 'bg-ledger-green'
            : tone === 'waiting'
              ? 'bg-ledger-amber'
              : tone === 'problem'
                ? 'bg-ledger-red'
                : 'bg-subtle',
        )}
      />
      <span className="text-sm font-medium text-muted">{label}</span>
    </span>
  )
}

// ---- helpers ----
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h`
}

function durLabel(dur: number | null | undefined): string {
  if (dur === undefined) return '?'
  if (dur === null) return 'N/A'
  const m = Math.floor(dur / 60)
  const s = dur % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
