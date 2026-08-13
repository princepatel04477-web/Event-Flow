/**
 * Matching a re-imported sheet back onto existing rows via the hidden id
 * columns the exporter writes.
 *
 * WHY THIS IS A SEPARATE MODULE. The importer matches on
 * `guest_groups.source_row_hash` (head name + primary mobile + group code),
 * with a second pass on normalised head name. That works for the *original*
 * CALLING_MASTER_LIST, where no ids exist. It is the wrong key for a sheet
 * that came out of this app: the exported sheet is edited precisely because
 * something was wrong, and the fields most likely to be corrected — a
 * mistyped mobile, a misspelt head name — are the same fields the hash is
 * built from. Correcting one changes the row's identity and forks a
 * duplicate family, which is exactly the failure CLAUDE.md guarantee #6
 * exists to prevent.
 *
 * A `group_id` carried in a hidden column does not move when someone fixes a
 * spelling, so it is the stronger key whenever it is present.
 *
 * Pure and dependency-free so it can be wired into whichever import pipeline
 * is current without dragging anything with it.
 */

/** Header names the exporter writes. Matched case-insensitively on import. */
export const GROUP_ID_HEADER = 'group_id'
export const GUEST_ID_HEADER = 'guest_id'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value.trim())
}

/**
 * Pull the hidden ids out of one parsed row.
 *
 * Tolerant about the header, because the round trip is not clean: Excel
 * upper-cases nothing but users do, and a sheet that has been through Google
 * Sheets and back can arrive with padded headers. Anything that is not a
 * well-formed uuid is treated as absent rather than as an error — a user
 * typing over a hidden column should degrade to hash matching, not halt the
 * import.
 */
export function readRowIds(row: Record<string, unknown>): {
  groupId: string | null
  guestId: string | null
} {
  let groupId: string | null = null
  let guestId: string | null = null

  for (const [header, value] of Object.entries(row)) {
    const key = header.trim().toLowerCase()
    if (key === GROUP_ID_HEADER && isUuid(value)) groupId = value.trim()
    if (key === GUEST_ID_HEADER && isUuid(value)) guestId = value.trim()
  }

  return { groupId, guestId }
}

export type IdMatch =
  /** No usable id — fall through to hash / name matching as before. */
  | { kind: 'no-id' }
  /** The id names a family in this event: update it, never insert. */
  | { kind: 'matched'; groupId: string }
  /**
   * The id is well-formed but belongs to no family in this event — a row
   * pasted in from another event's sheet, or from a wiped database.
   */
  | { kind: 'unknown-id'; groupId: string }

/**
 * Decide what a row's hidden id means, given the families this event holds.
 *
 * `unknown-id` is deliberately its own outcome rather than being folded into
 * `no-id`. Silently falling back to hash matching there would take a row
 * carrying another event's group_id and create a brand new family from it —
 * a cross-event leak that looks like an ordinary import. The caller should
 * surface it in the preview's warning list and let a human decide.
 */
export function matchRowById(
  row: Record<string, unknown>,
  knownGroupIds: ReadonlySet<string>,
): IdMatch {
  const { groupId } = readRowIds(row)
  if (!groupId) return { kind: 'no-id' }
  return knownGroupIds.has(groupId)
    ? { kind: 'matched', groupId }
    : { kind: 'unknown-id', groupId }
}

/**
 * True when a parsed sheet looks like one this app produced.
 *
 * Lets the preview say "this is a re-import, {n} families will be updated"
 * instead of presenting an update as a fresh load of new families.
 */
export function looksLikeExportedSheet(headers: readonly string[]): boolean {
  return headers.some((h) => h.trim().toLowerCase() === GROUP_ID_HEADER)
}

export interface IdMatchSummary {
  /** Rows that will update an existing family by id. */
  matched: number
  /** Rows carrying an id this event does not know. Needs a human. */
  unknown: number
  /** Rows with no id — ordinary hash/name matching applies. */
  withoutId: number
}

export function summariseIdMatches(
  rows: readonly Record<string, unknown>[],
  knownGroupIds: ReadonlySet<string>,
): IdMatchSummary {
  const summary: IdMatchSummary = { matched: 0, unknown: 0, withoutId: 0 }

  for (const row of rows) {
    const match = matchRowById(row, knownGroupIds)
    if (match.kind === 'matched') summary.matched += 1
    else if (match.kind === 'unknown-id') summary.unknown += 1
    else summary.withoutId += 1
  }

  return summary
}
