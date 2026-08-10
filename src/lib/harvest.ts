'use client'

import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/**
 * Typed wrapper for the native CallRecordingHarvestPlugin.
 *
 * Matches the existing plugin pattern (src/lib/call/plugin.ts):
 * registerPlugin with a web stub that mirrors the native surface but
 * returns safe defaults. On native, Capacitor replaces this with the
 * real plugin instance at runtime.
 */
export interface RecordingFile {
  name: string
  size: number
  mtime: number
  path: string
  ageSec: number
}

export interface DetectEvent {
  path: string
  name: string
  size: number
  mtime: number
}

export interface HarvestPluginType {
  hasPermission(): Promise<{ granted: boolean }>
  requestPermission(): Promise<{ granted: boolean }>
  discoverFolders(opts?: { folderOverride?: string }): Promise<{ folders: string[] }>
  listFiles(opts: { folder: string }): Promise<{ path: string; files: RecordingFile[] }>
  getDuration(opts: { path: string }): Promise<{ path: string; durationSec?: number }>
  startWatching(opts: { folders: string[] }): Promise<void>
  stopWatching(): Promise<void>
  addListener(
    event: 'recordingDetected',
    cb: (e: DetectEvent) => void,
  ): Promise<PluginListenerHandle>
}

const Harvest = registerPlugin<HarvestPluginType>('CallRecordingHarvest', {
  web: () => ({
    hasPermission: async () => ({ granted: false }),
    requestPermission: async () => ({ granted: false }),
    discoverFolders: async () => ({ folders: [] }),
    listFiles: async () => ({ path: '', files: [] }),
    getDuration: async () => ({ path: '' }),
    startWatching: async () => {},
    stopWatching: async () => {},
    addListener: async () => ({ remove: async () => undefined }),
  }),
})

export { Harvest }

/** True on native (Capacitor is available), false on web. */
export const isHarvestAvailable = (): boolean => {
  if (typeof window === 'undefined') return false
  try { return Boolean((window as unknown as Record<string, unknown>).Capacitor) } catch { return false }
}

export async function hasPermission(): Promise<boolean> {
  try {
    const { granted } = await Harvest.hasPermission()
    return granted
  } catch {
    return false
  }
}

export async function requestPermission(): Promise<boolean> {
  try {
    const { granted } = await Harvest.requestPermission()
    return granted
  } catch {
    return false
  }
}

export async function discoverFolders(override?: string): Promise<string[]> {
  try {
    const { folders } = await Harvest.discoverFolders(
      override ? { folderOverride: override } : undefined,
    )
    return folders
  } catch {
    return []
  }
}

export async function listFiles(folder: string): Promise<RecordingFile[]> {
  try {
    const result = await Harvest.listFiles({ folder })
    return result.files ?? []
  } catch {
    return []
  }
}

export async function getDuration(path: string): Promise<number | null> {
  try {
    const result = await Harvest.getDuration({ path })
    return result.durationSec ?? null
  } catch {
    return null
  }
}

export async function startWatching(folders: string[]): Promise<void> {
  if (folders.length === 0) return
  try { await Harvest.startWatching({ folders }) } catch {}
}

export async function stopWatching(): Promise<void> {
  try { await Harvest.stopWatching() } catch {}
}

export function onRecordingDetected(
  handler: (event: DetectEvent) => void,
): () => void {
  let listener: { remove: () => void } | null = null
  Harvest.addListener('recordingDetected', handler)
    .then((l) => { listener = l })
    .catch(() => {})
  return () => { if (listener) listener.remove() }
}
