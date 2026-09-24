import type { RecordingFile } from './harvest-types'

/**
 * The state of one discovered folder's file listing.
 *
 * THREE states, not two, and the third is the whole point. `files: []` is a
 * FACT — this folder was listed and it is empty. A folder nobody has listed
 * yet is not the same thing, and rendering it as "Empty folder" is a claim the
 * screen cannot support. Before this module the seed was `files: []` plus
 * `loading: true`, so every freshly discovered folder announced "Loading…"
 * for the rest of the session while nothing was loading, and only a manual
 * "List files" tap could clear it. `null` is that missing middle state.
 */
export interface FolderListing {
  path: string
  /** `null` = never listed. `[]` = listed, and genuinely empty. */
  files: RecordingFile[] | null
  loading: boolean
  error?: string
}

/** What the row should show. One case per honest state, in display order. */
export type ListingView =
  | { kind: 'unlisted' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'empty' }
  | { kind: 'files'; files: RecordingFile[] }

/**
 * A folder as `discoverFolders()` hands it over: found, and NOT yet listed.
 *
 * `loading: false` is deliberate rather than lazy. Discovering returns paths
 * without reading them, so nothing is in flight and the row must not claim
 * otherwise. The alternative — firing `listFiles` for every discovered path —
 * was rejected because it is worse exactly where this screen is used: on a
 * handset with poor signal, N concurrent native reads leave every row saying
 * "Loading…" for an unknown length of time, which is the unresolved spinner
 * this bug is about, only now with real work behind it. A row that says
 * nothing until the operator asks is honest on a bad connection; a row that
 * says "Loading…" is a guess about the network.
 */
export function discoveredListing(path: string): FolderListing {
  return { path, files: null, loading: false }
}

/** The same seed for a whole discovery pass. */
export function discoveredListings(paths: readonly string[]): FolderListing[] {
  return paths.map(discoveredListing)
}

/**
 * Resolve a listing to the one thing the row renders.
 *
 * `loading` is checked first so an in-flight re-list covers a stale error, and
 * an unknown path (a folder with no listing entry at all) resolves to
 * `unlisted` rather than to a claim about its contents.
 */
export function listingView(listing: FolderListing | undefined): ListingView {
  if (!listing) return { kind: 'unlisted' }
  if (listing.loading) return { kind: 'loading' }
  if (listing.error) return { kind: 'error', message: listing.error }
  if (listing.files === null) return { kind: 'unlisted' }
  if (listing.files.length === 0) return { kind: 'empty' }
  return { kind: 'files', files: listing.files }
}
