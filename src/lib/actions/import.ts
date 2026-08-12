'use server'

/**
 * Read-only support for the Excel import PREVIEW.
 *
 * ---------------------------------------------------------------------------
 * THIS MODULE WRITES NOTHING, AND THAT IS THE POINT
 * ---------------------------------------------------------------------------
 * An earlier version of this file carried a full commit path: it inserted
 * `import_batches`, `import_rows`, `guest_groups` and the head `guests` row
 * through supabase-js. It has been removed in full, for two reasons that are
 * worth keeping written down so nobody restores it from git history:
 *
 *  1. It could not be atomic. PostgREST has no multi-statement transaction, so
 *     that code was a sequence of independent HTTP writes with hand-rolled
 *     partial-failure reporting. Half an import landing is not a failure mode
 *     238 families can absorb. The replacement is a single Postgres function,
 *     `app.commit_guest_import()`, written in the session that follows this
 *     one — one statement, one transaction, one outcome.
 *
 *  2. It had no protection rule. `effectiveGroupFields()` coalesced incoming
 *     values over existing ones field by field, which means re-running the
 *     sheet would happily overwrite an `rsvp_status` the calling team had
 *     already set by phone. The Excel file is a snapshot of what somebody
 *     typed in March; a `confirmed` set from a recorded, human-reviewed call
 *     is evidence. The sheet must never win against it. Enforcing that belongs
 *     in the same function that does the write, not in a client round-trip.
 *
 * What survives is exactly one read: the counts this event already holds, so
 * the preview can say "this event already has 238 families" instead of letting
 * an operator wonder whether they are about to double the list. The parser
 * itself (`src/lib/import/**`) touches no database at all and runs in the
 * browser — the guest list never leaves the device to be previewed.
 *
 * `events.starts_on` / `events.ends_on` are NOT read here. The import page is
 * a server component that has already resolved the event row, so it passes
 * those two dates straight down as props; a second query would only be a
 * second chance to disagree with the first.
 */

import { z } from 'zod'

import { getEventAccess } from '@/lib/supabase/queries'
import { createClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

/**
 * Why this is asked at all, rather than assumed:
 *
 * RLS makes "you are not permitted" and "there is no data" indistinguishable.
 * A client-role login reading `guest_groups` gets zero rows and NO error. If
 * the preview reported those zeros as fact it would tell that account the
 * event is empty — and CLAUDE.md §15 lists the import preview among the things
 * that may never be cut, which only means anything if it never lies.
 */
const NOT_STAFF_MESSAGE =
  'You are not staff on this event, so its guest list is invisible to your account. ' +
  'Nothing was read and nothing was written — ask an admin to add you as event_team.'

export interface ImportContext {
  /** False when the counts below are not trustworthy; show `error`, not zeros. */
  ok: boolean
  error: string | null
  /** Families already in `guest_groups` for this event. */
  existingFamilies: number
  /** People already in `guests` for this event. */
  existingGuests: number
}

function emptyContext(error: string): ImportContext {
  return { ok: false, error, existingFamilies: 0, existingGuests: 0 }
}

/**
 * Counts what this event already holds. Two `head: true` count queries and
 * nothing else — no rows are fetched, so no guest data crosses the wire to
 * render a number.
 */
export async function readImportContext(eventId: string): Promise<ImportContext> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return emptyContext(NOT_STAFF_MESSAGE)
  }

  const supabase = await createClient()

  const [groups, guests] = await Promise.all([
    supabase
      .from('guest_groups')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId),
    supabase.from('guests').select('id', { count: 'exact', head: true }).eq('event_id', eventId),
  ])

  const failure = groups.error ?? guests.error
  if (failure) {
    return emptyContext(`Could not read what this event already holds: ${failure.message}`)
  }

  // A null count on either query means the response came back without a count
  // header — the DB accepted the query but the transport layer dropped the
  // number. Treating that as 0 is how you silently duplicate every family.
  // This is the call-intelligence seed-543 pattern: a failed count returned 0,
  // the script inserted 543 against an event that already had 543. Import is a
  // higher-consequence write — 238 families, not 543 seed rows — so it fails
  // loudly rather than returning a number it cannot verify.
  if (groups.count === null || guests.count === null) {
    return emptyContext(
      'The count queries returned, but without numbers. The database accepted ' +
        'the query; the transport layer dropped the count headers — this is a ' +
        'network blip, not an empty event. Wait a moment and retry, or check ' +
        'the connection. (Refusing to treat a lost count as zero.)',
    )
  }

  return {
    ok: true,
    error: null,
    existingFamilies: groups.count,
    existingGuests: guests.count,
  }
}

// ---------------------------------------------------------------------------
// COMMIT — the actual write, via app.commit_guest_import()
// ---------------------------------------------------------------------------

/** A single travel leg, as ParsedTravelLeg in families.ts. */
const legSchema = z.object({
  travelDate: z.string().nullable(),
  travelTime: z.string().nullable(),
  mode: z.string().nullable(),
  reference: z.string().nullable(),
  point: z.string().nullable(),
  hasAnyValue: z.boolean(),
})

/**
 * One family as the preview parsed it. Field names match the contract
 * documented in supabase/migrations/20260805001000_import_commit.sql — the
 * SQL reads `groupCode`, `city`, `rowNumber` and `raw`, so sending the
 * preview's own `familyNumber`/`place` names would drop them on the floor.
 * The server re-derives `rowHash` from the identifying cells rather than
 * trusting anything the client computed — a forged hash would let a client
 * force an "update" onto a family it does not own. Hash inputs match
 * src/lib/import/hash.ts.
 */
const commitFamilySchema = z.object({
  rowNumber: z.number(),
  raw: z.record(z.string(), z.unknown()),
  familyNumber: z.string(),
  headName: z.string().nullable(),
  primaryMobile: z.string().nullable(),
  place: z.string().nullable(),
  expectedPax: z.number().nullable(),
  canImport: z.boolean(),
  blockReason: z.string().nullable(),
  arrival: legSchema,
  departure: legSchema,
})

/** Sheet cells are JSON-able (strings, numbers, null) — a safe cast at the
 *  boundary to satisfy the RPC's `Json` argument type. */
function toJson(value: Record<string, unknown>): Json {
  return value as unknown as Json
}

export interface CommitResult {
  ok: boolean
  error: string | null
  summary: {
    inserted: number
    updated: number
    skipped: number
    failed: number
    total: number
    batchId: string | null
  } | null
}

/**
 * Confirm an import: hand the parsed families to the database in one
 * transaction. Admin-only by product decision (mirrors the page gate).
 */
export async function commitImport(
  eventId: string,
  fileName: string,
  families: z.infer<typeof commitFamilySchema>[],
): Promise<CommitResult> {
  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return { ok: false, error: NOT_STAFF_MESSAGE, summary: null }
  }

  const parsed = commitFamilySchema.array().safeParse(families)
  if (!parsed.success) {
    return { ok: false, error: 'The preview payload was not valid — re-upload the sheet.', summary: null }
  }

  // Re-derive each row's hash server-side (identity = group code + head name
  // + primary mobile, exactly as src/lib/import/hash.ts does). The rest of
  // the shape matches the SQL contract in migration 0010: groupCode/city are
  // the names the function reads, so the preview's familyNumber/place are
  // translated here, not sent under their own names.
  const rows = parsed.data.map((f) => ({
    rowNumber: f.rowNumber,
    raw: toJson(f.raw),
    canImport: f.canImport,
    blockReason: f.blockReason,
    headName: f.headName,
    groupCode: f.familyNumber,
    primaryMobile: f.primaryMobile,
    expectedPax: f.expectedPax,
    city: f.place,
    arrival: f.arrival,
    departure: f.departure,
    rowHash: rowHashServer({
      groupCode: f.familyNumber,
      headName: f.headName ?? '',
      primaryMobile: f.primaryMobile,
    }),
  }))

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('commit_guest_import', {
    p_event_id: eventId,
    p_kind: 'guests',
    p_filename: fileName,
    p_rows: rows,
  })

  if (error) {
    return {
      ok: false,
      error:
        error.code === '42501'
          ? 'Not permitted. Only staff can import guests.'
          : `The import did not land: ${error.message}`,
      summary: null,
    }
  }

  const summary = data as {
    inserted: number
    updated: number
    skipped: number
    failed: number
    total: number
    batchId: string
  }
  return { ok: true, error: null, summary }
}

// cyrb53 — same algorithm as src/lib/import/hash.ts so the server-derivation
// matches the client's. Kept inline (not imported) so this action stays free
// of any client-only module concerns.
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

const FIELD_SEPARATOR = String.fromCharCode(1)

function normKey(value: string | null | undefined): string {
  if (!value) return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

function rowHashServer(identity: {
  groupCode: string | null
  headName: string
  primaryMobile: string | null
}): string {
  return cyrb53(
    [normKey(identity.groupCode), normKey(identity.headName), normKey(identity.primaryMobile)].join(
      FIELD_SEPARATOR,
    ),
  )
}
