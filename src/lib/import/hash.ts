/**
 * Row identity hashing for Excel import.
 *
 * Pure, dependency-free and synchronous on purpose: it runs both in the
 * browser (building the preview from a freshly parsed sheet) and on the
 * server (re-deriving the same hash from the payload before it ever touches
 * `guest_groups.source_row_hash`, so a client can't smuggle in a hash that
 * doesn't match its own data).
 *
 * Hashes ONLY the identifying cells - head name, primary mobile, group code
 * - never the whole row. See CLAUDE.md guarantee #5: a corrected remark must
 * update the existing family, not create a duplicate one.
 */

export interface RowIdentity {
  headName: string
  primaryMobile: string | null
  groupCode: string | null
}

/**
 * cyrb53 - a small, well-distributed non-cryptographic string hash.
 * Public domain (https://github.com/bryc/code/blob/master/jshash/experimental/cyrb53.js).
 * We don't need cryptographic strength here, just a stable digest for a few
 * hundred rows per event; avoiding Web Crypto keeps this function sync so it
 * can run identically on the client and inside a server action.
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed

  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }

  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  const combined = 4294967296 * (2097151 & h2) + (h1 >>> 0)
  return combined.toString(16).padStart(14, '0')
}

/**
 * Case/whitespace-insensitive so "4th" and "4TH" hash identically.
 *
 * Exported because `classifyRows` needs the exact same normalisation to match
 * a row against an existing family by head name when the hash itself has
 * moved — see the identity-drift note below.
 */
export function normKey(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Separator joined between identity fields before hashing. A control
 * character that can never appear in a normalised cell value, so a value
 * split across a field boundary can never collide with a different split of
 * the same characters (e.g. groupCode="ab"+headName="c" vs "a"+"bc").
 */
const FIELD_SEPARATOR = String.fromCharCode(1)

/**
 * Stable, order-independent hex digest of a row's identifying fields.
 *
 * "Order-independent" means the result depends only on the semantic
 * identity tuple (group code, head name, mobile) in a fixed canonical
 * order - never on which spreadsheet column each field happened to live in,
 * since that varies sheet to sheet.
 */
export function rowHash(identity: RowIdentity): string {
  const canonical = [
    normKey(identity.groupCode),
    normKey(identity.headName),
    normKey(identity.primaryMobile),
  ].join(FIELD_SEPARATOR)

  return cyrb53(canonical)
}

/**
 * IDENTITY DRIFT — read this before relying on the hash alone.
 *
 * The hash is computed over the POST-normalisation mobile, so a cell the
 * normaliser could not reduce to 10 digits contributes an empty string. The
 * operator then reads the preview warning, fixes the cell, re-imports — and
 * the row's identity has changed. Matching on hash alone would create a
 * duplicate family for every mobile the operator corrected, which is exactly
 * the failure CLAUDE.md guarantee #5 forbids. Mapping the group-code column
 * on a second run does the same thing.
 *
 * The hash therefore is not the only matcher. `classifyRows` falls back to
 * matching on the normalised head name, accepting an existing family only
 * when every identifying field that is present on BOTH sides agrees and the
 * match is unambiguous — then rewrites `source_row_hash` to the new canonical
 * value so the fast path takes over from the next run onward.
 */
export function identityMatches(
  row: { groupCode: string | null; primaryMobile: string | null },
  existing: { group_code: string | null; primary_mobile: string | null },
): boolean {
  const codeRow = normKey(row.groupCode)
  const codeDb = normKey(existing.group_code)
  if (codeRow && codeDb && codeRow !== codeDb) return false

  const mobRow = normKey(row.primaryMobile)
  const mobDb = normKey(existing.primary_mobile)
  if (mobRow && mobDb && mobRow !== mobDb) return false

  return true
}
