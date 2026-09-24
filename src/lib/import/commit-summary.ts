/**
 * The sentence that ends a guest import.
 *
 * The counts ARE the screen. A successful import of the calling list writes
 * 238 families in about a second with no other feedback the operator can see,
 * and the only honest way to distinguish "it worked", "some of it was already
 * there so it updated in place", and "it silently did nothing" is to print all
 * four counts. Without them the reasonable response to a doubt is to upload
 * the file again.
 *
 * All four counts always appear, including the zeroes. Omitting a zero reads
 * as "not measured" rather than "none", and "skipped" is exactly the number a
 * second import produces.
 *
 * Pure and dependency-free, so the mapping from the RPC's summary object to
 * the words on screen can be asserted without rendering anything, and so a
 * count can never be dropped by a caller that forgot to interpolate it.
 */
export interface CommitCounts {
  inserted: number
  updated: number
  skipped: number
  failed: number
  total: number
}

export function commitCountsSentence(counts: CommitCounts): string {
  return (
    `${counts.inserted} inserted · ${counts.updated} updated · ` +
    `${counts.skipped} skipped · ${counts.failed} failed — ${counts.total} total.`
  )
}

/**
 * The batch id, shortened for reading aloud over a phone. `null` is a real
 * state — the RPC's summary is cast, not validated — so it gets words rather
 * than the string "null" or an empty gap.
 */
export function batchReference(batchId: string | null | undefined): string {
  return batchId ? `Batch ${batchId.slice(0, 8)}` : 'Batch reference unavailable'
}
