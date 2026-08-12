-- =====================================================================
-- delivery_proofs: add the pair CHECK (NOT VALID)
-- =====================================================================
-- L1.4 proved a team session can insert a proof with BOTH captured_by and
-- captured_by_staff set. delivery_proofs is insert-only, so the row can
-- never be corrected. The export reads captured_by_staff; other readers
-- read captured_by.
--
-- Migration 20260809130000 closed every app path: the INSERT policy now
-- requires captured_by IS NULL when captured_by_staff is set, and the
-- route_attribution trigger fills one column. But only a database CHECK
-- holds unconditionally — service-role writers bypass policies and triggers
-- that fire only for the specific role. The CHECK fires for EVERY insert,
-- including the service role and superuser.
--
-- Two existing rows (in the E2E event, written by test tooling through the
-- service role) have NEITHER column set. They cannot be repaired or
-- deleted. NOT VALID grandfaths them: new rows must satisfy the constraint;
-- existing rows are never validated. This is deliberate — convalidated =
-- false is the documented decision, not an oversight.
-- =====================================================================

-- Escaped column references here: captured_by is "captured_by" — a reserved
-- keyword — and Postgres requires quoting.
alter table public.delivery_proofs
  add constraint delivery_proofs_captured_by_one_of
  check (num_nonnulls("captured_by", captured_by_staff) = 1)
  not valid;
