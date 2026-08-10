export interface RecordingFile {
  name: string
  size: number
  mtime: number
  path: string
  ageSec: number
}

export interface DurationResult {
  path: string
  durationSec?: number
}

export interface DetectEvent {
  path: string
  name: string
  size: number
  mtime: number
}

export type HarvestLedgerStatus =
  | 'seen'
  | 'matched'
  | 'uploaded'
  | 'unmatched'
  | 'failed'

export interface HarvestLedgerEntry {
  path: string
  size: number
  mtime: number
  status: HarvestLedgerStatus
  callRecordingId?: string
  firstSeenAt: number
  lastError?: string
}
