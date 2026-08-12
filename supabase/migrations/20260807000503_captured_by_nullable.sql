-- =====================================================================
-- 1903 CODE-AUTH — delivery_proofs.captured_by nullable
--
-- 1902 dropped the FK on call_attempts.caller_id but kept
-- delivery_proofs.captured_by NOT NULL. A code-auth insert records the
-- staff member in captured_by_staff and has NO auth user id to put in
-- captured_by — so the column must become nullable. Legacy rows keep
-- their auth user id; the FK to auth.users is preserved.
--
-- IDEMPOTENT: alter column drop not null is safe to re-run.
-- =====================================================================

alter table public.delivery_proofs
  alter column captured_by drop not null;
