/**
 * M43 — a discovered folder must never be pinned at "Loading…".
 *
 * `handleDiscover` seeded every folder with `loading: true` and nothing ever
 * called `listFiles`, so each row said "Loading…" for the rest of the session.
 * The admin could not tell "still working" from "found nothing" from "there is
 * nothing to read", and only a manual "List files" tap cleared it.
 *
 * The fix is a third state. `files: []` is a FACT — this folder was listed and
 * it is empty — and rendering a folder nobody has read as "Empty folder" would
 * be a different lie in place of the first one. `null` is "not listed yet", and
 * the assertions below are about that distinction rather than about the words.
 */
import { describe, expect, it } from 'vitest'

import {
  discoveredListing,
  discoveredListings,
  listingView,
  type FolderListing,
} from '@/lib/harvest-listings'
import type { RecordingFile } from '@/lib/harvest-types'

const file = (name: string): RecordingFile => ({
  name,
  size: 1024,
  mtime: 1_700_000_000_000,
  path: `/storage/emulated/0/Recordings/${name}`,
  ageSec: 90,
})

describe('a discovered folder starts unlisted, not loading (M43)', () => {
  it('is not loading and holds no files yet', () => {
    const listing = discoveredListing('/storage/emulated/0/Recordings')
    expect(listing.loading).toBe(false)
    expect(listing.files).toBeNull()
  })

  it('does the same for a whole discovery pass', () => {
    const listings = discoveredListings(['/a', '/b', '/c'])
    expect(listings.map((l) => l.path)).toEqual(['/a', '/b', '/c'])
    expect(listings.every((l) => l.loading === false)).toBe(true)
    expect(listings.every((l) => l.files === null)).toBe(true)
  })

  it('renders as unlisted, never as "Loading…" or "Empty folder"', () => {
    const view = listingView(discoveredListing('/a'))
    expect(view.kind).toBe('unlisted')
    expect(view.kind).not.toBe('loading')
    expect(view.kind).not.toBe('empty')
  })

  it('treats a folder with no listing entry as unlisted rather than empty', () => {
    expect(listingView(undefined).kind).toBe('unlisted')
  })
})

describe('the listing states are told apart (M43)', () => {
  const base: FolderListing = { path: '/a', files: null, loading: false }

  it('reports a genuinely empty listing as empty', () => {
    expect(listingView({ ...base, files: [] }).kind).toBe('empty')
  })

  it('reports a listed folder with files', () => {
    const view = listingView({ ...base, files: [file('call-1.m4a'), file('call-2.m4a')] })
    expect(view.kind).toBe('files')
    if (view.kind === 'files') expect(view.files).toHaveLength(2)
  })

  it('reports loading only while a read is actually in flight', () => {
    expect(listingView({ ...base, loading: true }).kind).toBe('loading')
  })

  it('reports a failed read as an error, with the message', () => {
    const view = listingView({ ...base, error: 'Could not read that folder.' })
    expect(view.kind).toBe('error')
    if (view.kind === 'error') expect(view.message).toBe('Could not read that folder.')
  })

  it('lets an in-flight re-list cover a previous error', () => {
    const view = listingView({ ...base, loading: true, error: 'stale' })
    expect(view.kind).toBe('loading')
  })
})
