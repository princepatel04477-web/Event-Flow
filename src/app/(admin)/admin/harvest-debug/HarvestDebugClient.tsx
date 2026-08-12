'use client'

import { useCallback, useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
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
  type RecordingFile,
} from '@/lib/harvest'
import {
  getLedgerEntries,
  type HarvestLedgerEntry,
} from '@/lib/harvest-ledger'

interface FolderListing {
  path: string
  files: RecordingFile[]
  loading: boolean
  error?: string
}

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
      setFolderListings(
        found.map((p) => ({ path: p, files: [], loading: true })),
      )
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

  const STATUS_TONES: Record<string, 'neutral' | 'success' | 'warning' | 'danger'> = {
    seen: 'neutral',
    matched: 'success',
    uploaded: 'success',
    unmatched: 'warning',
    failed: 'danger',
  }

  return (
    <div className="flex flex-col gap-4 pb-4">
      <h2 className="text-lg font-semibold text-fg">Harvest debug</h2>

      {/* Plugin status */}
      <Card>
        <CardHeader>
          <CardTitle>Plugin</CardTitle>
        </CardHeader>
        <CardBody>
          <Badge tone={pluginAvailable ? 'success' : 'danger'}>
            {pluginAvailable === null ? 'Checking…' : pluginAvailable ? 'Available' : 'Not available'}
          </Badge>
        </CardBody>
      </Card>

      {/* Permission */}
      <Card>
        <CardHeader>
          <CardTitle>Permission</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Badge tone={granted ? 'success' : 'warning'}>
              {granted === null ? 'Checking…' : granted ? 'Granted' : 'Not granted'}
            </Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="md" onClick={checkPerm}>
              Check again
            </Button>
            <Button variant="primary" size="md" onClick={handleRequestPermission} loading={granting}>
              Open settings
            </Button>
          </div>
          {error ? <p className="text-sm text-danger">{error}</p> : null}
        </CardBody>
      </Card>

      {/* Folders */}
      <Card>
        <CardHeader>
          <CardTitle>
            Folders ({folders.length})
            <Button variant="secondary" size="md" className="ml-auto" onClick={handleDiscover} loading={loading}>
              Discover
            </Button>
          </CardTitle>
        </CardHeader>
        <CardBody className="flex flex-col gap-3">
          {folders.length === 0 ? (
            <p className="text-sm text-muted">No folders found. Grant permission and try Discover.</p>
          ) : (
            folders.map((folder) => {
              const listing = folderListings.find((f) => f.path === folder)
              return (
                <div key={folder} className="rounded-xl bg-surface-2 p-3">
                  <p className="font-mono text-xs text-subtle break-all mb-2">{folder}</p>
                  <div className="flex gap-2 mb-2">
                    <Button variant="secondary" size="md" onClick={() => handleListFolder(folder)}>
                      List files
                    </Button>
                    <Button variant="secondary" size="md" onClick={handleWatch}>
                      Watch
                    </Button>
                    <Button variant="secondary" size="md" onClick={handleStopWatch}>
                      Stop
                    </Button>
                  </div>
                  {listing?.loading ? (
                    <p className="text-xs text-muted">Loading…</p>
                  ) : listing?.error ? (
                    <p className="text-xs text-danger">{listing.error}</p>
                  ) : listing?.files ? (
                    listing.files.length === 0 ? (
                      <p className="text-xs text-muted">Empty folder</p>
                    ) : (
                      <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                        {listing.files.map((f) => (
                          <li key={f.path} className="flex items-center gap-2 text-xs">
                            <Badge tone="neutral" size="sm">{durLabel(durationResults.get(f.path))}</Badge>
                            <span className="font-mono text-fg truncate flex-1">{f.name}</span>
                            <span className="text-subtle shrink-0">{formatBytes(f.size)}</span>
                            <span className="text-subtle shrink-0">{formatAge(f.ageSec)}</span>
                            <Button variant="ghost" size="md" onClick={() => handleGetDuration(f.path)}>
                              Duration
                            </Button>
                          </li>
                        ))}
                      </ul>
                    )
                  ) : null}
                </div>
              )
            })
          )}
        </CardBody>
      </Card>

      {/* Detected log */}
      <Card>
        <CardHeader>
          <CardTitle>Detected ({detectedLog.length})</CardTitle>
        </CardHeader>
        <CardBody>
          {detectedLog.length === 0 ? (
            <p className="text-sm text-muted">No events yet. Watch folders and place a call.</p>
          ) : (
            <ul className="flex flex-col gap-1 max-h-64 overflow-y-auto">
              {detectedLog.map((d, i) => (
                <li key={i} className="font-mono text-xs text-fg">
                  <span className="text-subtle">{new Date(d.at).toLocaleTimeString()}</span>{' '}
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
            Ledger ({ledger.length})
            <Button variant="secondary" size="md" className="ml-auto" onClick={handleLoadLedger}>
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardBody>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted">Nothing tracked yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 max-h-80 overflow-y-auto">
              {ledger.map((entry) => (
                <li key={entry.path} className="rounded-lg bg-surface-2 px-3 py-2 text-xs font-mono">
                  <div className="flex items-center gap-2">
                    <Badge tone={STATUS_TONES[entry.status] ?? 'neutral'} size="sm">
                      {entry.status}
                    </Badge>
                    <span className="text-fg truncate flex-1">
                      {entry.path.split('/').pop()}
                    </span>
                  </div>
                  {entry.lastError ? (
                    <p className="mt-1 text-danger">{entry.lastError}</p>
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
