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
 *
 * EVERY call in here goes through `run()`. Outbound HTTPS from the build
 * machine is intermittent (TEST-LOG, "Environment note"), and on 2026-08-10 a
 * single dropped connection inside resetTestData() voided a four-minute run
 * and cascaded 18 tests into "did not run" — four times over. A harness that
 * reports the wifi rather than the code is worse than no harness, because a
 * red board stops meaning anything.
 */

const env = loadTestEnv()

export const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

export const EVENT_ID = env.E2E_EVENT_ID

// ---------------------------------------------------------------------------
// Retry layer
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 500

/**
 * Marker for "the harness could not reach the database", as opposed to "the
 * application misbehaved".
 *
 * The message is prefixed `[INFRA]` so e2e/report.mjs can classify the test as
 * INFRA instead of FAIL without needing to import anything from here — the
 * report only ever sees Playwright's serialised JSON.
 */
export class InfraError extends Error {
  constructor(message: string) {
    super(`[INFRA] ${message}`)
    this.name = 'InfraError'
  }
}

type DbError = { message: string; code?: string | null } | null

/**
 * Is this worth retrying?
 *
 * RETRY: transport failures (`fetch failed`, resets, timeouts) and 5xx. These
 * say nothing about the request.
 *
 * NEVER RETRY: a PostgREST/Postgres error carrying a real code — 23505 unique
 * violation, 42501 RLS refusal, PGRST116 no rows. Those fail identically every
 * time, and retrying one turns a crisp assertion failure into a slow one.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof Error && !(err as { code?: unknown }).code) {
    // A thrown TypeError('fetch failed') and friends — no structured code.
    return /fetch failed|network|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated/i.test(
      err.message,
    )
  }

  const e = err as DbError
  if (!e) return false

  const code = e.code ?? ''

  // A 5xx passed through as a bare status string.
  if (/^5\d\d$/.test(code)) return true

  // supabase-js surfaces transport failures as an error object with an empty
  // code and the underlying message.
  if (code === '') {
    return /fetch failed|network|timeout|ECONN|ETIMEDOUT|EAI_AGAIN|socket hang up|terminated/i.test(
      e.message ?? '',
    )
  }

  // Anything with a real SQLSTATE or PGRST code is a genuine refusal.
  return false
}

/**
 * Execute one Supabase call, retrying transport failures.
 *
 * `exec` must return a fresh builder each call — a PostgrestFilterBuilder is a
 * thenable that can only be awaited once, so retrying a stored one replays the
 * settled result instead of issuing a new request.
 */
async function run<T extends { error: DbError }>(
  label: string,
  exec: () => PromiseLike<T>,
): Promise<T> {
  let last: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: T
    try {
      res = await exec()
    } catch (thrown) {
      last = thrown
      if (!isRetryable(thrown)) {
        throw new Error(`${label} failed: ${(thrown as Error)?.message ?? String(thrown)}`)
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** (attempt - 1)))
        continue
      }
      break
    }

    if (!res.error) return res

    last = res.error
    if (!isRetryable(res.error)) {
      // A real database refusal — surface it immediately and unretried.
      throw new Error(`${label} failed: ${res.error.message}`)
    }
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, BACKOFF_BASE_MS * 2 ** (attempt - 1)))
    }
  }

  const detail = (last as { message?: string })?.message ?? String(last)
  throw new InfraError(`${label}: could not reach the database after ${MAX_ATTEMPTS} attempts (${detail})`)
}

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export async function countGuests(): Promise<number> {
  const { count } = await run('countGuests', () =>
    db.from('guests').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
  )
  if (count === null) throw new InfraError('countGuests: response carried no count header')
  return count
}

/** `family_heads` in the acceptance doc is `guest_groups` in the real schema. */
export async function countFamilyHeads(): Promise<number> {
  const { count } = await run('countFamilyHeads', () =>
    db.from('guest_groups').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
  )
  if (count === null) throw new InfraError('countFamilyHeads: response carried no count header')
  return count
}

export async function countRoomAssignments(): Promise<number> {
  const { count } = await run('countRoomAssignments', () =>
    db.from('room_assignments').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
  )
  if (count === null) throw new InfraError('countRoomAssignments: response carried no count header')
  return count
}

export async function countDeliveryProofs(): Promise<number> {
  const { count } = await run('countDeliveryProofs', () =>
    db.from('delivery_proofs').select('*', { count: 'exact', head: true }).eq('event_id', EVENT_ID),
  )
  if (count === null) throw new InfraError('countDeliveryProofs: response carried no count header')
  return count
}

export interface ProofRow {
  id: string
  storage_path: string
  recorded_at: string
  captured_by: string
  deliverable_id: string
}

export async function getLatestProof(): Promise<ProofRow | null> {
  const { data } = await run('getLatestProof', () =>
    db
      .from('delivery_proofs')
      .select('id, storage_path, recorded_at, captured_by, deliverable_id')
      .eq('event_id', EVENT_ID)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  )
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
  const { count } = await run('countProofPinnedFamilies', () =>
    db
      .from('guest_groups')
      .select('*', { count: 'exact', head: true })
      .eq('event_id', EVENT_ID)
      .ilike('head_name', `${PROOF_PREFIX}%`),
  )
  if (count === null) throw new InfraError('countProofPinnedFamilies: response carried no count header')
  return count
}

export async function createPendingDeliverable(kind: 'hamper' | 'return_gift' = 'hamper'): Promise<{
  deliverableId: string
  groupId: string
}> {
  const stamp = Date.now().toString(36)
  const name = `${PROOF_PREFIX}${stamp}`

  const { data: group } = await run('createPendingDeliverable group', () =>
    db
      .from('guest_groups')
      .insert({
        event_id: EVENT_ID,
        head_name: name,
        expected_pax: 1,
        rsvp_status: 'not_started',
        needs_return_gift: kind === 'return_gift',
      })
      .select('id')
      .single(),
  )
  if (!group) throw new InfraError('createPendingDeliverable: group insert returned no row')

  const { data: guest } = await run('createPendingDeliverable guest', () =>
    db
      .from('guests')
      .insert({ event_id: EVENT_ID, group_id: group.id, full_name: name, is_head: true })
      .select('id')
      .single(),
  )
  if (!guest) throw new InfraError('createPendingDeliverable: guest insert returned no row')

  const { data: deliv } = await run('createPendingDeliverable deliverable', () =>
    db
      .from('deliverables')
      .insert({ event_id: EVENT_ID, group_id: group.id, kind, item_name: name, status: 'pending' })
      .select('id')
      .single(),
  )
  if (!deliv) throw new InfraError('createPendingDeliverable: deliverable insert returned no row')

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
 *
 * THIS FUNCTION IS THE MOST EXPENSIVE PLACE TO FAIL. It runs in beforeAll, so
 * one dropped connection here does not fail one test — it fails the file's
 * first test and, under serial mode, skips every test after it. Four such
 * blips voided entire runs on 2026-08-10. Every statement retries.
 */
export async function resetTestData(): Promise<void> {
  await run('reset trip_passengers', () =>
    db.from('trip_passengers').delete().eq('event_id', EVENT_ID),
  )
  await run('reset trips', () => db.from('trips').delete().eq('event_id', EVENT_ID))
  await run('reset room_assignments', () =>
    db.from('room_assignments').delete().eq('event_id', EVENT_ID),
  )

  // Deliverables that carry a proof are permanent — skip them. Only
  // proof-less deliverables are deleted (their groups follow below).
  const [{ data: allDelivs }, { data: proofRows }] = await Promise.all([
    run('reset read deliverables', () =>
      db.from('deliverables').select('id, group_id').eq('event_id', EVENT_ID),
    ),
    run('reset read delivery_proofs', () =>
      db.from('delivery_proofs').select('deliverable_id').eq('event_id', EVENT_ID),
    ),
  ])
  const proofDelivs = new Set((proofRows ?? []).map((p) => p.deliverable_id))
  const proofLess = (allDelivs ?? []).filter((d) => !proofDelivs.has(d.id))
  if (proofLess.length > 0) {
    await run('reset deliverables', () =>
      db
        .from('deliverables')
        .delete()
        .in('id', proofLess.map((d) => d.id)),
    )
  }

  await run('reset travel_legs', () => db.from('travel_legs').delete().eq('event_id', EVENT_ID))

  // import_batches FIRST (its delete cascades to import_rows). Deleting
  // guest_groups while import_rows still reference it would SET NULL the
  // composite FK (group_id, event_id) — and import_rows.event_id is NOT
  // NULL, so the action fails. Clearing batches up front removes the rows
  // that would otherwise trip the FK action.
  await run('reset import_batches', () =>
    db.from('import_batches').delete().eq('event_id', EVENT_ID),
  )

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

  const { data: attemptedGroups } = await run('reset read call_attempts', () =>
    db.from('call_attempts').select('group_id').eq('event_id', EVENT_ID),
  )
  for (const a of attemptedGroups ?? []) {
    if (a.group_id) pinned.add(a.group_id)
  }

  const { data: seedGroups } = await run('reset read SEED-543 groups', () =>
    db.from('guest_groups').select('id').eq('event_id', EVENT_ID).ilike('head_name', 'SEED-543%'),
  )
  for (const s of seedGroups ?? []) {
    pinned.add(s.id)
  }

  const { data: groups } = await run('reset read guest_groups', () =>
    db.from('guest_groups').select('id').eq('event_id', EVENT_ID),
  )
  const deletable = (groups ?? []).filter((g) => !pinned.has(g.id)).map((g) => g.id)

  if (deletable.length > 0) {
    await run('reset guests', () => db.from('guests').delete().in('group_id', deletable))
    await run('reset guest_groups', () => db.from('guest_groups').delete().in('id', deletable))
  }
}
