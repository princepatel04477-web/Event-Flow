-- =====================================================================
-- 1300 FIX: delivery proof idempotency
-- =====================================================================
-- The offline proof queue retries submitProof() on reconnect, but each
-- call used a FRESH uuid in the storage path and a plain INSERT into
-- delivery_proofs. A flush that partially committed (photo uploaded, row
-- inserted, response lost) then retried would upload a second object and
-- insert a second proof row — the queue's "idempotency key" was never
-- actually used.
--
-- Fix in two parts, both here:
--   1. storage_path is now UNIQUE. The client uses its localId in the
--      filename, so a retry of an already-committed proof hits the unique
--      index and is treated as "already synced", not duplicated.
--   2. The client no longer generates its own uuid inside submitProof();
--      it accepts the queue's localId. (Client change, proof.ts.)
--
-- delivery_proofs stays insert-only: UPDATE/DELETE are still blocked by
-- trigger + RLS + grants. Uniqueness is a separate, additive guarantee.
--
-- IDEMPOTENCY: the index is created IF NOT EXISTS so this migration can be
-- pushed repeatedly, including over a live DB where a manual run already
-- created the index without recording the migration.
-- =====================================================================

create unique index if not exists delivery_proofs_storage_path_uq
  on public.delivery_proofs (storage_path);
