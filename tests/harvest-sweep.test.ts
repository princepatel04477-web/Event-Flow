/**
 * The harvest sweep's rules.
 *
 * Every assertion here is a rule that costs money or trust when it breaks:
 * uploading a file that is still being written transcribes a truncated call,
 * uploading the phone's back catalogue bills STT for calls nobody consented to
 * hand over, and uploading the same file twice writes two rows into a table
 * that has no delete policy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/harvest', () => ({
  discoverFolders: vi.fn(async () => ['/Recordings/Call']),
  listFiles: vi.fn(async () => []),
  getDuration: vi.fn(async () => 42),
}))

vi.mock('@/lib/harvest-match', () => ({
  matchRecording: vi.fn(async () => ({
    kind: 'matched',
    callAttemptId: null,
    groupId: 'g1',
    eventId: 'e1',
    via: 'filename-phone',
    callKind: 'first' as const,
  })),
}))

vi.mock('@/lib/harvest-upload', () => ({
  commitHarvestedRecording: vi.fn(async () => ({ ok: true, recordingId: 'rec-1' })),
  buildHarvestStoragePath: (eventId: string, groupId: string, ext: string) =>
    `${eventId}/${groupId}/harvested-fixed.${ext}`,
  contentTypeFor: (name: string) => (name.endsWith('.m4a') ? 'audio/mp4' : null),
  extensionOf: (name: string) => name.split('.').pop() ?? '',
}))

const ledger = {
  entries: [] as Array<{ path: string; status: string; storagePath?: string }>,
}

vi.mock('@/lib/harvest-ledger', () => ({
  getLedgerEntries: vi.fn(async () => ledger.entries),
  addSeen: vi.fn(async () => {}),
  markMatched: vi.fn(async () => {}),
  markUploaded: vi.fn(async () => {}),
  markUnmatched: vi.fn(async () => {}),
  markFailed: vi.fn(async () => {}),
  markSkipped: vi.fn(async () => {}),
  rememberStoragePath: vi.fn(async () => {}),
}))

import { listFiles } from '@/lib/harvest'
import { matchRecording } from '@/lib/harvest-match'
import { commitHarvestedRecording } from '@/lib/harvest-upload'
import { markSkipped, markUnmatched, rememberStoragePath } from '@/lib/harvest-ledger'
import { sweepHarvest } from '@/lib/harvest-sweep'

const ENABLED_AT = 1_700_000_000_000

function file(over: Partial<{ name: string; size: number; mtime: number; path: string; ageSec: number }> = {}) {
  return {
    name: 'Call_9876543210.m4a',
    size: 120_000,
    mtime: ENABLED_AT + 60_000,
    path: '/Recordings/Call/Call_9876543210.m4a',
    ageSec: 120,
    ...over,
  }
}

function sweep(over: Partial<Parameters<typeof sweepHarvest>[0]> = {}) {
  return sweepHarvest({
    eventId: 'e1',
    eventCode: 'E1',
    enabledAt: ENABLED_AT,
    consentGiven: true,
    folders: ['/Recordings/Call'],
    ...over,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  ledger.entries = []
  vi.mocked(listFiles).mockResolvedValue([])
  vi.mocked(matchRecording).mockResolvedValue({
    kind: 'matched',
    callAttemptId: null,
    groupId: 'g1',
    eventId: 'e1',
    via: 'filename-phone',
    callKind: 'first',
  })
  vi.mocked(commitHarvestedRecording).mockResolvedValue({ ok: true, recordingId: 'rec-1' })
})

describe('harvest sweep', () => {
  it('uploads a finished, matched recording', async () => {
    vi.mocked(listFiles).mockResolvedValue([file()])
    const result = await sweep()

    expect(result.uploaded).toBe(1)
    expect(commitHarvestedRecording).toHaveBeenCalledTimes(1)
    expect(vi.mocked(commitHarvestedRecording).mock.calls[0][0]).toMatchObject({
      groupId: 'g1',
      callAttemptId: null,
      durationSec: 42,
      consentGiven: true,
    })
  })

  it('does nothing at all without consent', async () => {
    vi.mocked(listFiles).mockResolvedValue([file()])
    const result = await sweep({ consentGiven: false })

    expect(result.uploaded).toBe(0)
    // Not even a match attempt: matching reads the guest list, and a phone with
    // no consent given should not be querying families at all.
    expect(matchRecording).not.toHaveBeenCalled()
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })

  it('leaves a file that is still being written for the next sweep', async () => {
    vi.mocked(listFiles).mockResolvedValue([file({ ageSec: 3 })])
    const result = await sweep()

    expect(result.uploaded).toBe(0)
    expect(result.deferred).toBe(1)
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })

  it('never touches recordings that predate consent', async () => {
    vi.mocked(listFiles).mockResolvedValue([
      file({ path: '/Recordings/Call/old.m4a', mtime: ENABLED_AT - 1 }),
    ])
    const result = await sweep()

    expect(result).toMatchObject({ uploaded: 0, deferred: 0, unmatched: 0, failed: 0 })
    expect(matchRecording).not.toHaveBeenCalled()
  })

  it('skips a container transcription cannot read', async () => {
    vi.mocked(listFiles).mockResolvedValue([file({ name: 'Call.txt', path: '/x/Call.txt' })])
    const result = await sweep()

    expect(result.uploaded).toBe(0)
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })

  it('never re-uploads a file the ledger already settled', async () => {
    const f = file()
    ledger.entries = [{ path: f.path, status: 'uploaded' }]
    vi.mocked(listFiles).mockResolvedValue([f])

    const result = await sweep()
    expect(result.uploaded).toBe(0)
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })

  it('leaves an unmatched file for the tray instead of failing it', async () => {
    vi.mocked(listFiles).mockResolvedValue([file()])
    vi.mocked(matchRecording).mockResolvedValue({
      kind: 'unmatched',
      reason: 'no call in the window',
    })

    const result = await sweep()
    expect(result.unmatched).toBe(1)
    expect(result.failed).toBe(0)
    expect(markUnmatched).toHaveBeenCalledWith(file().path)
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })

  it('retries onto the storage path a previous attempt already claimed', async () => {
    const f = file()
    ledger.entries = [{ path: f.path, status: 'seen', storagePath: 'e1/g1/harvested-first.m4a' }]
    vi.mocked(listFiles).mockResolvedValue([f])

    await sweep()

    expect(rememberStoragePath).toHaveBeenCalledWith(f.path, 'e1/g1/harvested-first.m4a')
    expect(vi.mocked(commitHarvestedRecording).mock.calls[0][0]).toMatchObject({
      storagePath: 'e1/g1/harvested-first.m4a',
    })
  })

  it('caps one sweep so a backlog cannot saturate the uplink', async () => {
    vi.mocked(listFiles).mockResolvedValue(
      Array.from({ length: 7 }, (_, i) =>
        file({ path: `/Recordings/Call/c${i}.m4a`, mtime: ENABLED_AT + i * 1000 }),
      ),
    )

    const result = await sweep()
    expect(result.uploaded).toBe(3)
    expect(result.deferred).toBe(4)
  })

  it('drains a backlog oldest first, so the review queue reads as the day did', async () => {
    vi.mocked(listFiles).mockResolvedValue([
      file({ path: '/Recordings/Call/late.m4a', mtime: ENABLED_AT + 9_000 }),
      file({ path: '/Recordings/Call/early.m4a', mtime: ENABLED_AT + 1_000 }),
    ])

    await sweep()
    const paths = vi.mocked(commitHarvestedRecording).mock.calls.map((c) => c[0].filePath)
    expect(paths).toEqual(['/Recordings/Call/early.m4a', '/Recordings/Call/late.m4a'])
  })

  it('reports an upload failure without burning the file', async () => {
    vi.mocked(listFiles).mockResolvedValue([file()])
    vi.mocked(commitHarvestedRecording).mockResolvedValue({ ok: false, error: 'No connection' })

    const result = await sweep()
    expect(result.failed).toBe(1)
    expect(result.lastError).toBe('No connection')
    // Left as `seen`, so the next sweep tries again.
    expect(markUnmatched).not.toHaveBeenCalled()
  })

  it('skips a reminder call match without uploading or committing', async () => {
    vi.mocked(listFiles).mockResolvedValue([file()])
    vi.mocked(matchRecording).mockResolvedValue({
      kind: 'matched',
      callAttemptId: 'att-1',
      groupId: 'g1',
      eventId: 'e1',
      via: 'call-window',
      callKind: 'reminder',
    })

    const result = await sweep()

    expect(result.skipped).toBe(1)
    expect(result.uploaded).toBe(0)
    expect(result.failed).toBe(0)
    expect(markSkipped).toHaveBeenCalledWith(file().path, expect.any(String))
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })

  it('never picks up a file with skipped ledger status', async () => {
    const f = file()
    ledger.entries = [{ path: f.path, status: 'skipped' }]
    vi.mocked(listFiles).mockResolvedValue([f])

    const result = await sweep()
    expect(result.uploaded).toBe(0)
    expect(result.skipped).toBe(0)
    expect(matchRecording).not.toHaveBeenCalled()
    expect(commitHarvestedRecording).not.toHaveBeenCalled()
  })
})
