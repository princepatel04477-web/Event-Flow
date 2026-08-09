# Frontier Report — Nuvent Path A: A0 complete + verified, A1 re-confirmed, A2 gate reached

**Outcome:** A0 (call-intelligence schema) is **built, pushed to the live Supabase DB, and
verified 14/14** against the live project. A1's M1 audit verdict (**HEAVY → M2-ALT remote
shell**) was re-confirmed as still current against the live codebase. The plan's own hard
gate — A2's "CAN I HEAR THE OTHER PERSON" handset test — **cannot be run by me** (it needs
a physical handset and a real two-party call), so A3–A6 are correctly not started, exactly
as the plan's structure requires.

## What changed (A0)

Two new append-only migrations (nothing existing edited by me):
- `supabase/migrations/20260807000100_call_intelligence.sql` — extends the existing 0200
  tables in place (expand-migrate-contract): `call_recordings` gains `consent_given` +
  insert-only triggers + RLS revoke; `transcripts` gains `raw_response`/`full_text`/
  `segments`/`detected_languages`/`status`/`error_text` + unique `recording_id`;
  `rsvp_extractions` gains `model_version`/`prompt_version`/`fields`/`overall_confidence` +
  `unique (id, event_id)`; the `extraction_status` enum gains `draft`/`in_review`/`committed`
  (keeping `pending`/`accepted`/`rejected`/`superseded` for the live review screens);
  new `extraction_field_reviews` table (insert-only).
- `supabase/migrations/20260807000101_call_intelligence_idx.sql` — the partial unique index
  (one committed extraction per transcript), in its own migration because PG forbids using a
  just-added enum value in the same transaction (SQLSTATE 55P04).
- `src/lib/actions/rsvp.ts` — one targeted assertion to the generated `save_rsvp_log` Args
  type (the generator over-infers the RPC's nullable params as non-nullable).
- `docs/a0-design.md` — the rubric, constraint ledger, verification record, and named limitations.
- `scripts/verify-a0.mjs` + `scripts/clean-a0-probe.mjs` — the durable verification artifacts.

## EVIDENCE

- **Live push:** `supabase db push` applied both migrations; `supabase migration list` shows
  20260807000100 and 20260807000101 recorded on remote.
- **Idempotency:** a second (and third) `db push` returned "Remote database is up to date."
- **A0 probe:** `node scripts/verify-a0.mjs` → **14/14 PASS**:
  - V1/V2: `call_recordings` UPDATE+DELETE blocked by trigger under the **service role**
    (proves the trigger — service role bypasses RLS, exactly per A0's DoD).
  - V3/V4: `extraction_field_reviews` UPDATE+DELETE blocked.
  - V5: second `committed` extraction for the same transcript rejected by the partial unique
    index (`duplicate key ... one_committed_per_transcript`).
  - V6: `consent_given` defaults FALSE.
  - V7/V10: new columns present on `transcripts` and `rsvp_extractions`.
  - V8/V8b/V8c: enum has draft/in_review/committed AND keeps pending/accepted.
  - V9: **non-admin event_team user B** reads 0 rows of another event while reading 5 rows of
    their own — RLS is scoped, not blocking everything (positive control).
  - V11: `apply_rsvp_extraction()` still works end-to-end (pending → accepted) after the enum
    extension.
- **App gates:** `npx tsc --noEmit` clean; `npx eslint` clean on changed files; 94/94 unit
  tests pass.
- **M1 re-confirmation:** the audit (`docs/static-export-audit.md`, 2026-08-04, HEAVY) was
  re-checked against the live code: 18 server-action files (audit said 12), 34 server pages,
  cookie-session server client still the backbone, middleware now deleted but irrelevant to
  the verdict. **HEAVY holds — M2-ALT remains correct**, and the APK already exists in that
  mode.

## PASSES

- **Verifier pass 1 (fresh-eyes subagent, database/migration/idiom lens):** 8 findings.
  - Fixed: V9 was vacuous (tested an admin against an empty event) → now uses non-admin user
    B with a positive control; R6 was enum-labels-only → added V11 exercising the RPC.
  - Assessed/noted: R7 evidence mis-stated (pre-existing working-tree edits to 5 migrations
    from a prior session, not mine — corrected in the design doc); `attach_standard_triggers`
    helper non-idempotency is repo-wide convention; TRUNCATE gap is inherited repo-wide
    (delivery_proofs too); client-role zero-read verified structurally (no client creds exist).
- The two clean gates (typecheck + lint + unit tests + probe) then confirmed the fixes.
- Mode: **quick** (rubric → produce → one whole-rubric verifier pass → fix → report).

## CANDIDATES

Phase 1 (best-of-N candidates) was skipped: A0 is a schema migration constrained by the
repo's existing patterns and the A0 spec — a design with one right answer per decision, not a
creative direction call. The design decisions are documented in `docs/a0-design.md` (notably:
extend `rsvp_extractions` in place rather than renaming to `extractions`, to keep the live
review screens and RPCs compiling).

## GATE

Not run. This is low-stakes engineering work (internal schema migration), not public/brand
work, so the taste gate (Phase 5) is out of scope per the protocol. The fresh-eyes verifier
served as the quality gate.

## DECISIONS

1. **Extended `rsvp_extractions` in place** instead of renaming to `extractions` — the live
   review screens + `apply_rsvp_extraction` + `database.types.ts` all reference it; rename
   breaks them for zero benefit.
2. **Extended the `extraction_status` enum** (added 3 values) instead of replacing it — the
   live review page reads `pending`; `apply_rsvp_extraction` reads `accepted`/`rejected`.
3. **Partial unique index scoped per transcript** (one committed per transcript) — the natural
   unit; a repeat call is a new transcript, so a new committed extraction is allowed.
4. **`call_recordings` + `extraction_field_reviews` use the delivery_proofs pattern** (block
   trigger + RLS select/insert-only + revoke update/delete) — matching A0's "same pattern as
   delivery_proofs" literally. `transcripts`/`rsvp_extractions` keep UPDATE (workers/review
   need it).
5. **Split the enum-add and the index-using-it into two migrations** — PG 17 forbids using a
   just-added enum value in the same transaction (hit live, fixed).
6. **Regenerated `database.types.ts`** — this surfaced a pre-existing drift in `rsvp.ts`
   (generator over-infers nullable RPC args); fixed with a targeted, commented assertion to
   the generated Args type (no `any`/`unknown`/`!`).

## UNVERIFIED

- **A2's capture gate** (can the handset record the guest's side) — needs a physical handset
  and a real 3-minute call. This is the plan's own hard stop. **Smallest thing to continue:**
  run a real call on the team handset, play back the file from a temporary listing screen,
  and answer "both sides audible or only mine?" A2 part 3 in the prompt.
- **A1's handset DoD** (APK installs, force-stop survival, hot reload, chrome://inspect,
  Sentry test error) — all require the physical device. The APK infrastructure (M2-ALT
  remote shell, CallPlugin, Capacitor) is in the repo and was built in prior sessions.
- **Client-role zero-read** was verified structurally (RLS sel policies gate on
  `app.is_staff(event_id)`), not behaviorally — no client-role credentials exist in the env
  files.
- **`TRUNCATE` on insert-only tables** is not blocked anywhere in the repo (pre-existing,
  delivery_proofs included) — A0 copies the proven pattern; hardening TRUNCATE repo-wide is
  separate work.
- A3–A6 are **not started** — they are gated on A2 passing (per the plan's explicit structure
  and cost asymmetry).
