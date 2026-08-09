import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { loadTestEnv } from './env'

/**
 * Direct database access for the acceptance suite, using the service-role
 * key. TEST-ONLY — never imported by application code.
 *
 * Table names are the REAL ones from the migrations (CLAUDE.md §8, verified
 * against the live schema): the acceptance doc's `family_heads` is
 * `guest_groups`, `room_allocations` is `room_assignments`, and
 * `delivery_proofs` uses `recorded_at`/`captured_by` (not
 * `created_at`/`delivered_by`).
 */

const env = loadTestEnv()

export const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

export const EVENT_ID = env.E2E_EVENT_ID

export async function countGuests(): Promise<number> {
  const { count, error } = await db.from('guests').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID)
  if (error) throw new Error(`countGuests failed: ${error.message}`)
  return count ?? 0
}

/** `family_heads` in the acceptance doc is `guest_groups` in the real schema. */
export async function countFamilyHeads(): Promise<number> {
  const { count, error } = await db
    .from('guest_groups')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
  if (error) throw new Error(`countFamilyHeads failed: ${error.message}`)
  return count ?? 0
}

export async function countRoomAssignments(): Promise<number> {
  const { count, error } = await db
    .from('room_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
  if (error) throw new Error(`countRoomAssignments failed: ${error.message}`)
  return count ?? 0
}

export async function countDeliveryProofs(): Promise<number> {
  const { count, error } = await db
    .from('delivery_proofs')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
  if (error) throw new Error(`countDeliveryProofs failed: ${error.message}`)
  return count ?? 0
}

export interface ProofRow {
  id: string
  storage_path: string
  recorded_at: string
  captured_by: string
  deliverable_id: string
}

export async function getLatestProof(): Promise<ProofRow | null> {
  const { data, error } = await db
    .from('delivery_proofs')
    .select('id, storage_path, recorded_at, captured_by, deliverable_id')
    .eq('event_id', EVENT_ID)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getLatestProof failed: ${error.message}`)
  return (data as ProofRow | null) ?? null
}

/**
 * Create a fresh PENDING deliverable for a test, with its own throwaway
 * family, so a test never depends on which deliverables survived a reset.
 *
 * Proof-bearing deliverables are permanent, so after several runs the only
 * rows in `deliverables` may be delivered ones. Any test that needs a
 * pending deliverable (photo proof, offline, duplicate-delivery) must create
 * one here rather than expecting the table to be clean.
 *
 * The throwaway family uses the recognisable `E2E-PROOF-<timestamp>` prefix
 * so it is identifiable and can be EXCLUDED from any count/timing assertion
 * that needs a clean working set (see PROOF_PREFIX below). The proofs
 * themselves stay permanent — that insert-only guarantee is correct — but
 * they stop polluting the families the other tests count.
 *
 * Returns the deliverable id and the group id it belongs to.
 */
export const PROOF_PREFIX = 'E2E-PROOF-'

/** Count families whose head_name starts with PROOF_PREFIX (the permanent
 *  proof-pinned throwaways from T0.7/T1.2/T2.2). Used to exclude them from
 *  assertions that need the working set. */
export async function countProofPinnedFamilies(): Promise<number> {
  const { count, error } = await db
    .from('guest_groups')
    .select('*', { count: 'exact', head: true })
    .eq('event_id', EVENT_ID)
    .ilike('head_name', `${PROOF_PREFIX}%`)
  if (error) throw new Error(`countProofPinnedFamilies failed: ${error.message}`)
  return count ?? 0
}

export async function createPendingDeliverable(kind: 'hamper' | 'return_gift' = 'hamper'): Promise<{
  deliverableId: string
  groupId: string
}> {
  const stamp = Date.now().toString(36)
  const name = `${PROOF_PREFIX}${stamp}`

  const { data: group, error: gErr } = await db
    .from('guest_groups')
    .insert({
      event_id: EVENT_ID,
      head_name: name,
      expected_pax: 1,
      rsvp_status: 'not_started',
      needs_return_gift: kind === 'return_gift',
    })
    .select('id')
    .single()
  if (gErr || !group) throw new Error(`createPendingDeliverable group failed: ${gErr?.message}`)

  const { data: guest, error: guestErr } = await db
    .from('guests')
    .insert({ event_id: EVENT_ID, group_id: group.id, full_name: name, is_head: true })
    .select('id')
    .single()
  if (guestErr || !guest) throw new Error(`createPendingDeliverable guest failed: ${guestErr?.message}`)

  const { data: deliv, error: dErr } = await db
    .from('deliverables')
    .insert({ event_id: EVENT_ID, group_id: group.id, kind, item_name: name, status: 'pending' })
    .select('id')
    .single()
  if (dErr || !deliv) throw new Error(`createPendingDeliverable deliverable failed: ${dErr?.message}`)

  return { deliverableId: deliv.id, groupId: group.id }
}

/**
 * Wipe every row the acceptance run creates, in FK-safe order, so a second
 * run starts from a known state — while leaving the insert-only guarantee
 * intact.
 *
 * `delivery_proofs` is insert-only BY DESIGN (CLAUDE.md §5.2): the delete
 * trigger blocks even the service role, so proof rows cannot be cleaned
 * here and accumulate across runs. Worse, each proof RESTRICT-references its
 * deliverable (delivery_proofs_deliverable_id_fkey), so a proof-bearing
 * deliverable is itself permanent, and it pins its guest_groups row via
 * deliverables_group_id_event_id_fkey (CASCADE) and that group's guests.
 *
 * Reset therefore deletes only what a re-run can legitimately recreate:
 *   - deliverables WITHOUT any proof row (proof-less deliverables are safe
 *     to remove; their groups follow),
 *   - guest_groups NOT pinned by a proof-bearing deliverable AND NOT pinned
 *     by a call_attempts row (call_attempts is append-only; its DELETE
 *     trigger blocks even the service role, so a group it references can
 *     never be removed). Guests cascade off their group.
 *   - everything else with no insert-only blocker (trips, passengers,
 *     assignments, travel legs, import batches).
 *
 * Tests must NOT assume a clean table: any test that needs a pending
 * deliverable creates one itself, and proof-count assertions are DELTAS
 * (before vs after), never absolute totals.
 */
export async function resetTestData(): Promise<void> {
  const { error: tripsErr } = await db.from('trip_passengers').delete().eq('event_id', EVENT_ID)
  if (tripsErr) throw new Error(`reset trip_passengers failed: ${tripsErr.message}`)

  const { error: trips2Err } = await db.from('trips').delete().eq('event_id', EVENT_ID)
  if (trips2Err) throw new Error(`reset trips failed: ${trips2Err.message}`)

  const { error: raErr } = await db.from('room_assignments').delete().eq('event_id', EVENT_ID)
  if (raErr) throw new Error(`reset room_assignments failed: ${raErr.message}`)

  // Deliverables that carry a proof are permanent — skip them. Only
  // proof-less deliverables are deleted (their groups follow below).
  const [{ data: allDelivs }, { data: proofRows }] = await Promise.all([
    db.from('deliverables').select('id, group_id').eq('event_id', EVENT_ID),
    db.from('delivery_proofs').select('deliverable_id').eq('event_id', EVENT_ID),
  ])
  const proofDelivs = new Set((proofRows ?? []).map((p) => p.deliverable_id))
  const proofLess = (allDelivs ?? []).filter((d) => !proofDelivs.has(d.id))
  if (proofLess.length > 0) {
    const { error: delErr } = await db.from('deliverables').delete().in('id', proofLess.map((d) => d.id))
    if (delErr) throw new Error(`reset deliverables failed: ${delErr.message}`)
  }

  const { error: legErr } = await db.from('travel_legs').delete().eq('event_id', EVENT_ID)
  if (legErr) throw new Error(`reset travel_legs failed: ${legErr.message}`)

  // import_batches FIRST (its delete cascades to import_rows). Deleting
  // guest_groups while import_rows still reference it would SET NULL the
  // composite FK (group_id, event_id) — and import_rows.event_id is NOT
  // NULL, so the action fails. Clearing batches up front removes the rows
  // that would otherwise trip the FK action.
  const { error: batchErr } = await db.from('import_batches').delete().eq('event_id', EVENT_ID)
  if (batchErr) throw new Error(`reset import_batches failed: ${batchErr.message}`)

  // Groups pinned by a proof-bearing deliverable must stay (their
  // deliverables' RESTRICT FK forbids removal). So must groups with any
  // call_attempts row — call_attempts is append-only, its DELETE trigger
  // blocks even the service role, and the group CASCADE would try to delete
  // them. So must the SEED-543 scale fixture — it is the standing 543-guest
  // baseline the suite runs at (scripts/seed-543.mjs tops it up, and the
  // seed re-runs on every acceptance run, but deleting it mid-run would
  // drop the suite to ~100 guests and break the scale contract). Everything
  // else goes; guests cascade off their group.
  const pinned = new Set(
    (allDelivs ?? [])
      .filter((d) => proofDelivs.has(d.id))
      .map((d) => d.group_id)
      .filter((g): g is string => g !== null),
  )
  const { data: attemptedGroups } = await db
    .from('call_attempts')
    .select('group_id')
    .eq('event_id', EVENT_ID)
  for (const a of attemptedGroups ?? []) {
    if (a.group_id) pinned.add(a.group_id)
  }
  const { data: seedGroups } = await db
    .from('guest_groups')
    .select('id')
    .eq('event_id', EVENT_ID)
    .ilike('head_name', 'SEED-543%')
  for (const s of seedGroups ?? []) {
    pinned.add(s.id)
  }

  const { data: groups } = await db.from('guest_groups').select('id').eq('event_id', EVENT_ID)
  const deletable = (groups ?? []).filter((g) => !pinned.has(g.id)).map((g) => g.id)

  if (deletable.length > 0) {
    const { error: guestsErr } = await db.from('guests').delete().in('group_id', deletable)
    if (guestsErr) throw new Error(`reset guests failed: ${guestsErr.message}`)

    const { error: groupsErr } = await db.from('guest_groups').delete().in('id', deletable)
    if (groupsErr) throw new Error(`reset guest_groups failed: ${groupsErr.message}`)
  }
}
