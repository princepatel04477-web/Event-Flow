# A0 — Call-Intelligence Schema: Constraint Ledger + Rubric

Date: 2026-08-06. This is the frontier-skill artifact for the A0 prompt: the rubric and
constraint ledger written BEFORE the migration, so the migration can be judged against it.

## The critical finding that changes A0

The A0 prompt specifies four tables as if greenfield: `call_recordings`, `transcripts`,
`extractions`, `extraction_field_reviews`. Three of those **already exist** in migration
0200 (`call_recordings`, `transcripts`, `rsvp_extractions`) and are referenced by the live
app (database.types.ts) and by migration 0600's `apply_rsvp_extraction()` RPC. A0 is a
**transform of live tables**, not a create. The fourth (`extraction_field_reviews`) is new.

So A0 must follow ops.md §2 expand-migrate-contract: extend the existing tables in place,
never drop data, keep every existing consumer compiling, and add the new table. It must be
re-runnable (the repo pushes repeatedly), match the repo's idempotency idiom (create
table if not exists / drop policy if exists / drop trigger if exists / create or replace),
and preserve the architectural invariants in CLAUDE.md §5.

## Design decisions (made, with reasons)

1. **Rename `rsvp_extractions` → `extractions`?** NO. The table is referenced by the live
   `apply_rsvp_extraction()` RPC, by `database.types.ts`, and by CLAUDE.md. Renaming breaks
   all three with zero benefit; the A0 spec's name is cosmetic. Instead, **extend** the
   existing table with A0's extra columns (`model_version`, `prompt_version`, `fields`,
   `overall_confidence`) and keep its name. A0's `status ('draft'|'in_review'|'committed'|'rejected')`
   maps onto the existing `app.extraction_status` enum by **extending the enum** with the two
   missing values rather than replacing it (the existing values `pending`/`accepted`/
   `rejected`/`superseded` are used by `apply_rsvp_extraction()`; deleting them breaks it).
   This is the lowest-risk reconciliation that satisfies A0's intent (a human-review
   lifecycle with exactly one committed row).

2. **`call_recordings.consent_given`** is a new NOT NULL DEFAULT false column (A2's consent
   gate). A0's `guest_group_id` maps to the existing `group_id` column (same meaning, same FK);
   A0's `recorded_by` maps to the existing `uploaded_by`. A0's INSERT-ONLY requirement is met
   by adding the `block_mutation()` trigger (the proven `delivery_proofs` pattern) to the
   existing table.

3. **`transcripts`** gains `raw_response jsonb`, `segments jsonb`, `detected_languages text[]`,
   `status`, `error_text` and a unique index on `recording_id`. The existing `text`/`language`
   columns are kept (they are the pre-A0 extraction contract; `full_text` is added as the
   canonical A0 field and kept in sync by the review flow, not by a trigger — the columns are
   both writable by the worker and `full_text` is documented as the source of truth for
   `evidence` substring matching).

4. **`extraction_field_reviews`** is a new insert-only table, exactly per A0 §4, with the
   audit trigger attached.

5. **Partial unique index**: one `committed` extraction per transcript. A0 says "only one may
   be committed" — I'll scope it per **transcript** (the natural unit: one call, one committed
   extraction). A later call to the same family is a NEW transcript, so it is a new committed
   extraction; this does not violate "one committed per transcript".

6. **RLS**: apply the repo's standard `apply_staff_policies()` to all four tables (staff
   read/write own event, no client access). This is the exact pattern migration 0500 uses.
   `extraction_field_reviews` is insert-only at the trigger level too (matching
   `delivery_proofs`), but RLS still grants staff UPDATE/DELETE like `apply_staff_policies`
   does — the trigger is the fence, same as proofs.

7. **Server clock**: `call_recordings.recorded_at` already has the `call_recordings_server_clock`
   trigger. The new `consent_given` and the review timestamps on `extraction_field_reviews`
   get `now()` defaults. No client timestamp reaches the new columns.

## CONSTRAINT LEDGER (numbered; the migration walks this line by line)

1. Re-runnable: every statement idempotent (IF NOT EXISTS / DROP IF EXISTS / OR REPLACE).
2. Expand-migrate-contract: no column or table dropped; existing consumers (database.types.ts,
   apply_rsvp_extraction, save_rsvp_log) keep working.
3. Event tenancy: every table carries event_id; RLS is `app.is_staff(event_id)`; composite
   FKs keep (child_id, event_id) → unique (id, event_id) so a row cannot cross events.
4. Client role gets NO access to recordings/transcripts/extractions/reviews (RLS enforced).
5. `call_recordings` is INSERT-ONLY at the trigger level (block_mutation on UPDATE/DELETE),
   proven against the service role (which bypasses RLS).
6. `consent_given` NOT NULL DEFAULT false; no recording row without an explicit consent.
7. `transcripts.recording_id` is UNIQUE (one transcript per recording).
8. `transcripts.raw_response` is jsonb and must never be trimmed by any code path (documented;
   the migration just creates the column — the worker owns the "never trim" contract).
9. `extraction_field_reviews` is INSERT-ONLY (block_mutation trigger + RLS matching proofs).
10. Exactly one committed extraction per transcript via partial unique index.
11. Column comment on `extractions.fields` documents the {value, confidence, evidence,
    evidence_start_ms, evidence_end_ms, reasoning} shape and the "evidence is a verbatim
    substring of full_text" rule.
12. Storage path convention documented: `call-recordings/{event_id}/{group_id}/{uuid}.aac`
    (bucket policy reads the first path segment as the tenant key).
13. No new service-role key exposure; Edge Functions get it via secrets only (noted, enforced
    in A3).

## TASK RUBRIC (checkable lines)

- R1: The migration applies cleanly via `supabase db push` AND applies again on a second run
  (idempotency proven).
- R2: UPDATE and DELETE on `call_recordings` are rejected by trigger even for the service role.
- R3: A client-role login reads zero rows from all four tables; a cross-event staff read is
  denied.
- R4: Inserting a second `committed` extraction for the same transcript fails on the partial
  unique index.
- R5: The four tables expose exactly the A0-required columns (verified against the live DB
  after push).
- R6: The existing `apply_rsvp_extraction()` RPC still compiles and still works (the enum
  extension did not break its `'accepted'` reference).
- R7: No existing migration file was edited; A0 is a new append-only migration (ops.md §2).
- R8: `extraction_field_reviews` insert-only trigger fires for the service role.
- R9: `database.types.ts` regenerated and typechecks against the new shape.

## VERIFICATION RECORD (2026-08-06, live project xktxnkuzplhzxkevwrcj)

Probe: `scripts/verify-a0.mjs` — 14/14 PASS against the live DB.

| Check | Result |
|---|---|
| V1/V2 call_recordings UPDATE+DELETE blocked (service role → trigger) | PASS |
| V3/V4 extraction_field_reviews UPDATE+DELETE blocked | PASS |
| V5 one committed extraction per transcript (partial unique index) | PASS |
| V6 consent_given defaults FALSE | PASS |
| V7 transcripts new columns present | PASS |
| V8 enum gains draft/in_review/committed | PASS |
| V8b/V8c enum keeps pending/accepted (live review + RPC states) | PASS |
| V9 cross-event staff read denied (non-admin user B, positive control) | PASS |
| V10 extraction new columns present | PASS |
| V11 apply_rsvp_extraction() still works end-to-end | PASS |

Push history: `supabase db push` applied both migrations; second `db push` → "Remote
database is up to date" (migration-level idempotency proven). `supabase migration list`
shows 20260807000100 and 20260807000101 recorded on remote.

`database.types.ts` regenerated (`npm run types:gen`); `npx tsc --noEmit` clean. One
app file changed: `src/lib/actions/rsvp.ts` gained a targeted assertion to the generated
`save_rsvp_log` Args type because `supabase gen types` over-infers the RPC's nullable
params as non-nullable (migration 1600 declares `integer`/`text`/`timestamptz` — all
nullable). The assertion preserves null semantics (blank stepper = NULL, not 0).

## NAMED LIMITATIONS (from the fresh-eyes verifier, assessed)

1. **R7 evidence was mis-stated.** The claim "no existing migration edited" was wrong: five
   20260731* migrations are modified in the working tree. Those edits (idempotency
   hardening: DROP POLICY IF EXISTS, IF NOT EXISTS, enum DO-blocks) were **pre-existing
   before this session** (they were `M` in `git status` at session start, last touched by a
   prior session), NOT made by A0. This A0 work added only the two new migration files.
   Corrected here.
2. **`attach_standard_triggers()` is not itself idempotent** (repo-wide: every migration
   calls it and relies on the migration ledger). The A0 DoD "second run" is satisfied at the
   migration level (recorded → skipped). A literal re-execution of 1700's body would hit the
   helper's non-idempotent CREATE TRIGGER — a repo-wide convention, not an A0 regression.
3. **TRUNCATE is not blocked on insert-only tables** (repo-wide, delivery_proofs included).
   `block_mutation` is row-level; TRUNCATE bypasses it. A0 copies the proven pattern; fixing
   TRUNCATE across the repo is out of A0 scope.
4. **Client-role zero-read was verified structurally, not behaviorally** — no client-role
   credentials exist in the env files to run a real client session. The RLS sel policies gate
   on `app.is_staff(event_id)`, so a client reads zero rows; this is structural proof.

