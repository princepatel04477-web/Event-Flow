'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getEventAccess } from '@/lib/supabase/queries'
import type { Database, Json } from '@/lib/supabase/database.types'
import { identityMatches, normKey, rowHash } from '@/lib/import/hash'
import type { ImportRowFields } from '@/lib/import/rows'

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

type Side = Database['app']['Enums']['side']
type GroupType = Database['app']['Enums']['group_type']

/** Sent from the client for every row that made it through the mapper. */
export interface ImportRowInput extends ImportRowFields {
  rowNumber: number
  raw: Record<string, unknown>
  canImport: boolean
  blockReason: string | null
}

interface PreparedRow extends ImportRowInput {
  hash: string
}

interface ExistingGroup {
  id: string
  source_row_hash: string | null
  head_name: string
  group_code: string | null
  primary_mobile: string | null
  alt_mobile: string | null
  expected_pax: number
  side: Side | null
  group_type: GroupType
  city: string | null
  remarks: string | null
  needs_return_gift: boolean
}

interface ExistingHead {
  id: string
  group_id: string
  full_name: string
  mobile: string | null
}

const GROUP_SELECT =
  'id, source_row_hash, head_name, group_code, primary_mobile, alt_mobile, expected_pax, side, group_type, city, remarks, needs_return_gift'

/**
 * Thrown when the viewer is not staff on this event. RLS makes "not
 * permitted" and "no data" indistinguishable — a client login reading
 * `guest_groups` gets zero rows and no error — so the preview would happily
 * report "238 New" for a database that already holds all 238. The preview
 * screen is the one mechanism CLAUDE.md forbids cutting; it must never
 * fabricate.
 */
class NotStaffError extends Error {
  constructor() {
    super(
      'You are not staff on this event, so the guest list is invisible to your account. ' +
        'Nothing was read or written — ask an admin to add you as event_team.',
    )
    this.name = 'NotStaffError'
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function coalesce<T>(incoming: T | null, existing: T): T {
  return incoming === null ? existing : incoming
}

/** Values to write, with "keep whatever is already there" semantics on null -
 *  the same convention `apply_rsvp_extraction()` uses, so re-importing a
 *  sheet with fewer filled-in columns never blanks out enriched data. */
function effectiveGroupFields(row: PreparedRow, existing?: ExistingGroup) {
  return {
    head_name: (row.headName ?? existing?.head_name ?? '') as string,
    group_code: existing ? coalesce(row.groupCode, existing.group_code) : row.groupCode,
    primary_mobile: existing
      ? coalesce(row.primaryMobile, existing.primary_mobile)
      : row.primaryMobile,
    alt_mobile: existing ? coalesce(row.altMobile, existing.alt_mobile) : row.altMobile,
    expected_pax: existing ? coalesce(row.expectedPax, existing.expected_pax) : row.expectedPax,
    side: existing ? coalesce(row.side, existing.side) : row.side,
    group_type: existing ? coalesce(row.groupType, existing.group_type) : row.groupType,
    city: existing ? coalesce(row.city, existing.city) : row.city,
    remarks: existing ? coalesce(row.remarks, existing.remarks) : row.remarks,
    needs_return_gift: existing
      ? coalesce(row.needsReturnGift, existing.needs_return_gift)
      : (row.needsReturnGift ?? false),
  }
}

function groupFieldsDiffer(existing: ExistingGroup, row: PreparedRow): boolean {
  const f = effectiveGroupFields(row, existing)
  return (
    f.head_name !== existing.head_name ||
    f.group_code !== existing.group_code ||
    f.primary_mobile !== existing.primary_mobile ||
    f.alt_mobile !== existing.alt_mobile ||
    f.expected_pax !== existing.expected_pax ||
    f.side !== existing.side ||
    f.group_type !== existing.group_type ||
    f.city !== existing.city ||
    f.remarks !== existing.remarks ||
    f.needs_return_gift !== existing.needs_return_gift ||
    // A row matched by head name rather than by hash still needs its stored
    // hash brought up to date, even when nothing else changed.
    existing.source_row_hash !== row.hash
  )
}

interface Classification {
  prepared: PreparedRow[]
  blocked: PreparedRow[]
  importable: PreparedRow[]
  duplicates: Array<{ row: PreparedRow; canonical: PreparedRow }>
  toInsert: PreparedRow[]
  toUpdate: Array<{ row: PreparedRow; existing: ExistingGroup }>
  unchanged: Array<{ row: PreparedRow; existing: ExistingGroup }>
}

/**
 * Shared read-only classification used by both `previewImport` (stops here)
 * and `commitImport` (continues on to write). Never mutates the database.
 */
async function classifyRows(
  supabase: SupabaseServerClient,
  eventId: string,
  rows: ImportRowInput[],
): Promise<Classification> {
  const prepared: PreparedRow[] = rows.map((row) => ({
    ...row,
    hash: rowHash({
      headName: row.headName ?? '',
      groupCode: row.groupCode,
      primaryMobile: row.primaryMobile,
    }),
  }))

  const blocked: PreparedRow[] = []
  const importable: PreparedRow[] = []
  const duplicates: Array<{ row: PreparedRow; canonical: PreparedRow }> = []
  const firstByHash = new Map<string, PreparedRow>()

  for (const row of prepared) {
    if (!row.canImport || !row.headName) {
      blocked.push(row)
      continue
    }
    const canonical = firstByHash.get(row.hash)
    if (canonical) {
      duplicates.push({ row, canonical })
    } else {
      firstByHash.set(row.hash, row)
      importable.push(row)
    }
  }

  // --- pass 1: exact hash match (the fast path, and the common case) -----
  const existingByHash = new Map<string, ExistingGroup>()

  for (const c of chunk(importable.map((r) => r.hash), 300)) {
    if (c.length === 0) continue
    const { data, error } = await supabase
      .from('guest_groups')
      .select(GROUP_SELECT)
      .eq('event_id', eventId)
      .in('source_row_hash', c)

    if (error) throw new Error(`Could not check existing families: ${error.message}`)

    for (const g of data ?? []) {
      if (g.source_row_hash) existingByHash.set(g.source_row_hash, g as ExistingGroup)
    }
  }

  const matched = new Map<PreparedRow, ExistingGroup>()
  const claimedGroupIds = new Set<string>()
  const unmatched: PreparedRow[] = []

  for (const row of importable) {
    const existing = existingByHash.get(row.hash)
    if (existing) {
      matched.set(row, existing)
      claimedGroupIds.add(existing.id)
    } else {
      unmatched.push(row)
    }
  }

  // --- pass 2: head-name match, for rows whose identity drifted ----------
  // See the identity-drift note in import/hash.ts. Correcting a mobile the
  // preview warned about (or mapping the group-code column on a later run)
  // changes the hash; without this pass the corrected row imports as a
  // second copy of the same family.
  if (unmatched.length > 0) {
    const headNames = [...new Set(unmatched.map((r) => r.headName).filter((n): n is string => !!n))]
    const byHeadName = new Map<string, ExistingGroup[]>()

    for (const c of chunk(headNames, 200)) {
      if (c.length === 0) continue
      const { data, error } = await supabase
        .from('guest_groups')
        .select(GROUP_SELECT)
        .eq('event_id', eventId)
        .in('head_name', c)

      if (error) throw new Error(`Could not check existing families by name: ${error.message}`)

      for (const g of (data ?? []) as ExistingGroup[]) {
        const key = normKey(g.head_name)
        const bucket = byHeadName.get(key)
        if (bucket) bucket.push(g)
        else byHeadName.set(key, [g])
      }
    }

    for (const row of unmatched) {
      const candidates = (byHeadName.get(normKey(row.headName)) ?? []).filter(
        (g) => !claimedGroupIds.has(g.id) && identityMatches(row, g),
      )

      // Exactly one compatible family, or we cannot tell them apart and must
      // not guess — two genuinely different families can share a head name.
      if (candidates.length === 1) {
        matched.set(row, candidates[0])
        claimedGroupIds.add(candidates[0].id)
      }
    }
  }

  const toInsert: PreparedRow[] = []
  const toUpdate: Array<{ row: PreparedRow; existing: ExistingGroup }> = []
  const unchanged: Array<{ row: PreparedRow; existing: ExistingGroup }> = []

  for (const row of importable) {
    const existing = matched.get(row)
    if (!existing) {
      toInsert.push(row)
    } else if (groupFieldsDiffer(existing, row)) {
      toUpdate.push({ row, existing })
    } else {
      unchanged.push({ row, existing })
    }
  }

  return { prepared, blocked, importable, duplicates, toInsert, toUpdate, unchanged }
}

export type RowOutcomeStatus = 'new' | 'update' | 'unchanged' | 'duplicate' | 'blocked'

export interface RowOutcome {
  rowNumber: number
  status: RowOutcomeStatus
  reason: string | null
}

export interface PreviewResult {
  ok: boolean
  error?: string
  counts: Record<RowOutcomeStatus, number>
  rows: RowOutcome[]
}

/** Read-only: classifies every row against the live database. Writes nothing. */
export async function previewImport(
  eventId: string,
  rows: ImportRowInput[],
): Promise<PreviewResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return emptyPreview('You are signed out. Sign in again and retry.')
  }

  if (rows.length === 0) {
    return emptyPreview('Nothing to preview - the file had no usable rows.')
  }

  try {
    // Must come BEFORE any read: a non-staff account sees zero rows with no
    // error, which would render as "every family is new".
    const access = await getEventAccess(eventId)
    if (access !== 'admin' && access !== 'event_team') throw new NotStaffError()

    const c = await classifyRows(supabase, eventId, rows)

    const outcomes: RowOutcome[] = []

    for (const row of c.blocked) {
      outcomes.push({ rowNumber: row.rowNumber, status: 'blocked', reason: row.blockReason })
    }
    for (const row of c.toInsert) {
      outcomes.push({ rowNumber: row.rowNumber, status: 'new', reason: null })
    }
    for (const { row, existing } of c.toUpdate) {
      outcomes.push({
        rowNumber: row.rowNumber,
        status: 'update',
        reason: `Matches existing family "${existing.head_name}" - some fields will change.`,
      })
    }
    for (const { row } of c.unchanged) {
      outcomes.push({ rowNumber: row.rowNumber, status: 'unchanged', reason: null })
    }
    for (const { row, canonical } of c.duplicates) {
      outcomes.push({
        rowNumber: row.rowNumber,
        status: 'duplicate',
        reason: `Same family as sheet row ${canonical.rowNumber} in this file.`,
      })
    }

    outcomes.sort((a, b) => a.rowNumber - b.rowNumber)

    const counts: Record<RowOutcomeStatus, number> = {
      new: c.toInsert.length,
      update: c.toUpdate.length,
      unchanged: c.unchanged.length,
      duplicate: c.duplicates.length,
      blocked: c.blocked.length,
    }

    return { ok: true, counts, rows: outcomes }
  } catch (e) {
    return emptyPreview(e instanceof Error ? e.message : 'Could not build the preview.')
  }
}

export interface CommitRowResult {
  rowNumber: number
  status: 'inserted' | 'updated' | 'unchanged' | 'duplicate' | 'error'
  error: string | null
}

export interface CommitResult {
  ok: boolean
  /** Set when the run did not complete cleanly. `rows` may still describe real writes. */
  error?: string
  /**
   * True when `error` is set but writes DID land. The UI must show the
   * results, not a bare "import failed" — the database is not rolled back.
   */
  partial?: boolean
  batchId?: string
  totalRows: number
  inserted: number
  updated: number
  /** Rows deliberately not written: already up to date, or a duplicate within the file. */
  skipped: number
  /** Rows that were meant to be written and were not. Never folded into `skipped`. */
  failed: number
  rows: CommitRowResult[]
}

function emptyPreview(error: string): PreviewResult {
  return {
    ok: false,
    error,
    counts: { new: 0, update: 0, unchanged: 0, duplicate: 0, blocked: 0 },
    rows: [],
  }
}

function emptyCommit(error: string, batchId?: string): CommitResult {
  return {
    ok: false,
    error,
    batchId,
    totalRows: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    rows: [],
  }
}

/**
 * Writes a reviewed import: one `import_batches` row, one `import_rows` row
 * per sheet row, and for every importable row a `guest_groups` upsert plus
 * its mandatory head `guests` row. Re-running the same file reports
 * "0 inserted, 0 updated, N skipped" - see CLAUDE.md guarantee #5.
 *
 * There is no transaction across these statements and there cannot be one
 * through PostgREST, so this function NEVER reports total failure after a
 * partial write. Every stage records its own errors and execution continues;
 * the result always describes what actually landed.
 */
export async function commitImport(
  eventId: string,
  eventCode: string,
  filename: string,
  rows: ImportRowInput[],
): Promise<CommitResult> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return emptyCommit('You are signed out. Sign in again and retry the import.')
  }

  if (rows.length === 0) {
    return emptyCommit('Nothing to import - the file had no usable rows.')
  }

  const access = await getEventAccess(eventId)
  if (access !== 'admin' && access !== 'event_team') {
    return emptyCommit(new NotStaffError().message)
  }

  const { data: batch, error: batchError } = await supabase
    .from('import_batches')
    .insert({
      event_id: eventId,
      kind: 'guests',
      filename: filename || null,
      total_rows: rows.length,
      status: 'processing',
      imported_by: user.id,
    })
    .select('id')
    .single()

  if (batchError || !batch) {
    return emptyCommit(
      `Could not start the import batch: ${batchError?.message ?? 'unknown error'}. ` +
        'You are most likely not staff on this event.',
    )
  }

  const batchId = batch.id as string

  let c: Classification
  try {
    c = await classifyRows(supabase, eventId, rows)
  } catch (e) {
    // Nothing has been written yet, so this really is a clean failure.
    const message = e instanceof Error ? e.message : 'Could not classify the sheet.'
    await supabase
      .from('import_batches')
      .update({ status: 'failed', error: message, completed_at: new Date().toISOString() })
      .eq('id', batchId)
    return emptyCommit(message, batchId)
  }

  // Every stage below records into these and never throws past this point.
  const hashToGroupId = new Map<string, string>()
  const insertErrors = new Map<string, string>()
  const updateErrors = new Map<string, string>()
  const headErrors = new Map<string, string>() // keyed by group_id
  const stageWarnings: string[] = []

  // --- 1. bulk-insert new groups -------------------------------------
  for (const rowChunk of chunk(c.toInsert, 200)) {
    if (rowChunk.length === 0) continue
    const payload = rowChunk.map((row) => buildGroupInsert(eventId, row))
    const { data, error } = await supabase
      .from('guest_groups')
      .insert(payload)
      .select('id, source_row_hash')

    if (error) {
      // The whole chunk failed together - fall back to one at a time so a
      // single bad row doesn't sink every other family in the batch.
      for (const row of rowChunk) {
        const { data: single, error: singleError } = await supabase
          .from('guest_groups')
          .insert(buildGroupInsert(eventId, row))
          .select('id')
          .single()

        if (singleError || !single) {
          insertErrors.set(row.hash, singleError?.message ?? 'insert failed')
        } else {
          hashToGroupId.set(row.hash, single.id)
        }
      }
    } else {
      for (const g of data ?? []) {
        if (g.source_row_hash) hashToGroupId.set(g.source_row_hash, g.id)
      }
    }
  }

  // --- 2. individual updates (usually a small set) --------------------
  for (const { row, existing } of c.toUpdate) {
    const { error } = await supabase
      .from('guest_groups')
      .update(buildGroupUpdate(row, existing))
      .eq('id', existing.id)
      .eq('event_id', eventId)

    if (error) {
      updateErrors.set(row.hash, error.message)
    } else {
      hashToGroupId.set(row.hash, existing.id)
    }
  }

  for (const { row, existing } of c.unchanged) {
    hashToGroupId.set(row.hash, existing.id)
  }

  // --- 3. ensure every successful group has a head guest ---------------
  // The single most likely thing to get wrong: client_guest_profiles is
  // built from `guests`, not `guest_groups`. See Known Traps.
  const readyHashes = [...hashToGroupId.keys()].filter(
    (h) => !insertErrors.has(h) && !updateErrors.has(h),
  )

  if (readyHashes.length > 0) {
    const groupIds = readyHashes.map((h) => hashToGroupId.get(h)!)
    const existingHeads = new Map<string, ExistingHead>()
    let headLookupFailed = false

    for (const idChunk of chunk(groupIds, 300)) {
      const { data, error } = await supabase
        .from('guests')
        .select('id, group_id, full_name, mobile')
        .eq('event_id', eventId)
        .eq('is_head', true)
        .in('group_id', idChunk)

      if (error) {
        // Do NOT abort: the guest_groups rows above are already committed and
        // will not be rolled back. Record it, skip head reconciliation, and
        // report honestly. A re-import repairs the heads.
        headLookupFailed = true
        stageWarnings.push(`Could not check existing family heads: ${error.message}`)
        break
      }
      for (const g of data ?? []) existingHeads.set(g.group_id, g)
    }

    if (!headLookupFailed) {
      const rowByHash = new Map(c.importable.map((r) => [r.hash, r]))
      type HeadInsert = {
        event_id: string
        group_id: string
        full_name: string
        mobile: string | null
        is_head: true
      }
      const headsToInsert: HeadInsert[] = []
      const headUpdates: Array<{
        id: string
        groupId: string
        full_name: string
        mobile: string | null
      }> = []

      for (const hash of readyHashes) {
        const groupId = hashToGroupId.get(hash)!
        const row = rowByHash.get(hash)
        if (!row || !row.headName) continue

        const existingHead = existingHeads.get(groupId)
        const mobile = row.primaryMobile

        if (!existingHead) {
          headsToInsert.push({
            event_id: eventId,
            group_id: groupId,
            full_name: row.headName,
            mobile,
            is_head: true,
          })
        } else if (existingHead.full_name !== row.headName || existingHead.mobile !== mobile) {
          headUpdates.push({ id: existingHead.id, groupId, full_name: row.headName, mobile })
        }
      }

      for (const headChunk of chunk(headsToInsert, 200)) {
        if (headChunk.length === 0) continue
        const { error } = await supabase.from('guests').insert(headChunk)
        if (!error) continue

        // A multi-row INSERT is one statement: one violation (a head that
        // already exists and the select above missed, a transient drop)
        // fails all 200. Retry one at a time, exactly as step 1 does, so a
        // bad row cannot block good ones on the step client_guest_profiles
        // depends on.
        for (const h of headChunk) {
          const { error: singleError } = await supabase.from('guests').insert(h)
          if (singleError) headErrors.set(h.group_id, singleError.message)
        }
      }

      for (const u of headUpdates) {
        const { error } = await supabase
          .from('guests')
          .update({ full_name: u.full_name, mobile: u.mobile })
          .eq('id', u.id)
          .eq('event_id', eventId)
        if (error) headErrors.set(u.groupId, error.message)
      }
    }
  }

  // --- 4. assemble per-row outcomes ------------------------------------
  const results: CommitRowResult[] = []

  for (const row of c.blocked) {
    results.push({
      rowNumber: row.rowNumber,
      status: 'error',
      error: row.blockReason ?? 'Missing required field.',
    })
  }

  for (const row of c.toInsert) {
    const err = insertErrors.get(row.hash)
    if (err) {
      results.push({ rowNumber: row.rowNumber, status: 'error', error: err })
      continue
    }
    const groupId = hashToGroupId.get(row.hash)
    const headErr = groupId ? headErrors.get(groupId) : undefined
    results.push({
      rowNumber: row.rowNumber,
      status: headErr ? 'error' : 'inserted',
      error: headErr ? `Family saved, but the head guest record failed: ${headErr}` : null,
    })
  }

  for (const { row, existing } of c.toUpdate) {
    const err = updateErrors.get(row.hash)
    if (err) {
      results.push({ rowNumber: row.rowNumber, status: 'error', error: err })
      continue
    }
    const headErr = headErrors.get(existing.id)
    results.push({
      rowNumber: row.rowNumber,
      status: headErr ? 'error' : 'updated',
      error: headErr ? `Family updated, but the head guest record failed: ${headErr}` : null,
    })
  }

  for (const { row, existing } of c.unchanged) {
    const headErr = headErrors.get(existing.id)
    results.push({
      rowNumber: row.rowNumber,
      status: headErr ? 'error' : 'unchanged',
      error: headErr ? `Head guest record failed: ${headErr}` : null,
    })
  }

  for (const { row, canonical } of c.duplicates) {
    results.push({
      rowNumber: row.rowNumber,
      status: 'duplicate',
      error: `Duplicate of sheet row ${canonical.rowNumber} in this file (same family).`,
    })
  }

  results.sort((a, b) => a.rowNumber - b.rowNumber)

  // Counted explicitly, never as a remainder: `skipped` used to absorb every
  // errored row, so a batch with 40 failed heads recorded skipped_rows = 40
  // with nothing to say those were failures.
  const inserted = results.filter((r) => r.status === 'inserted').length
  const updated = results.filter((r) => r.status === 'updated').length
  const skipped = results.filter((r) => r.status === 'unchanged' || r.status === 'duplicate').length
  const failed = results.filter((r) => r.status === 'error').length

  // --- 5. write the audit trail ----------------------------------------
  const resultByRowNumber = new Map(results.map((r) => [r.rowNumber, r]))
  const groupIdByRowNumber = new Map<number, string | null>()
  for (const row of c.toInsert) {
    groupIdByRowNumber.set(row.rowNumber, hashToGroupId.get(row.hash) ?? null)
  }
  for (const { row, existing } of c.toUpdate) {
    groupIdByRowNumber.set(row.rowNumber, updateErrors.has(row.hash) ? null : existing.id)
  }
  for (const { row, existing } of c.unchanged) groupIdByRowNumber.set(row.rowNumber, existing.id)
  for (const { row, canonical } of c.duplicates) {
    groupIdByRowNumber.set(row.rowNumber, hashToGroupId.get(canonical.hash) ?? null)
  }

  const importRowsPayload = c.prepared.map((row) => {
    const outcome = resultByRowNumber.get(row.rowNumber)
    return {
      batch_id: batchId,
      event_id: eventId,
      row_number: row.rowNumber,
      raw: row.raw as Json,
      row_hash: row.hash,
      status: outcome?.status ?? 'error',
      group_id: groupIdByRowNumber.get(row.rowNumber) ?? null,
      error: outcome?.error ?? null,
    }
  })

  for (const rowChunk of chunk(importRowsPayload, 300)) {
    if (rowChunk.length === 0) continue
    const { error } = await supabase.from('import_rows').insert(rowChunk)
    if (error) stageWarnings.push(`Row-level audit trail incomplete: ${error.message}`)
  }

  const batchNote = stageWarnings.length > 0 ? stageWarnings.join(' | ') : null

  const { error: batchUpdateError } = await supabase
    .from('import_batches')
    .update({
      status: failed > 0 || stageWarnings.length > 0 ? 'completed_with_errors' : 'completed',
      inserted_rows: inserted,
      updated_rows: updated,
      skipped_rows: skipped,
      completed_at: new Date().toISOString(),
      error: batchNote,
    })
    .eq('id', batchId)

  if (batchUpdateError) {
    // The writes landed; only the batch bookkeeping did not. Say so rather
    // than leaving a `processing` batch row that contradicts the database.
    stageWarnings.push(
      `The guest rows were written, but this import batch could not be marked complete ` +
        `(${batchUpdateError.message}). The batch record in import_batches is out of date.`,
    )
  }

  revalidatePath(`/${eventCode}`, 'layout')

  const problem = stageWarnings.length > 0 ? stageWarnings.join(' | ') : undefined

  return {
    ok: true,
    error: problem,
    partial: problem !== undefined,
    batchId,
    totalRows: results.length,
    inserted,
    updated,
    skipped,
    failed,
    rows: results,
  }
}

function buildGroupInsert(eventId: string, row: PreparedRow) {
  const f = effectiveGroupFields(row)
  return {
    event_id: eventId,
    source_row_hash: row.hash,
    head_name: f.head_name,
    group_code: f.group_code,
    primary_mobile: f.primary_mobile,
    alt_mobile: f.alt_mobile,
    expected_pax: f.expected_pax ?? undefined,
    side: f.side,
    group_type: f.group_type ?? undefined,
    city: f.city,
    remarks: f.remarks,
    needs_return_gift: f.needs_return_gift,
  }
}

function buildGroupUpdate(row: PreparedRow, existing: ExistingGroup) {
  const f = effectiveGroupFields(row, existing)
  return {
    // Converge the stored identity onto the current canonical hash, so a row
    // matched by head name after a corrected mobile takes the fast path next
    // run instead of drifting again.
    source_row_hash: row.hash,
    head_name: f.head_name,
    group_code: f.group_code,
    primary_mobile: f.primary_mobile,
    alt_mobile: f.alt_mobile,
    // NOT NULL columns with a default: `coalesce()` never actually produces
    // null when `existing` is passed, but the shared helper's return type
    // can't express that per call site, so satisfy the Update type here.
    expected_pax: f.expected_pax ?? undefined,
    side: f.side,
    group_type: f.group_type ?? undefined,
    city: f.city,
    remarks: f.remarks,
    needs_return_gift: f.needs_return_gift,
  }
}
