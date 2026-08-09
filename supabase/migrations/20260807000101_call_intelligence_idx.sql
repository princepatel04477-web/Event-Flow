-- =====================================================================
-- 1701 CALL-INTELLIGENCE (A0) — PARTIAL UNIQUE INDEX
--
-- Runs as its OWN migration because the 'committed' enum value it
-- references is added by migration 1700. Postgres forbids using a
-- just-added enum value in the same transaction (SQLSTATE 55P04), so this
-- index is a separate transaction that runs after 1700 commits.
--
-- Exactly one committed extraction per transcript. The 0200 index on
-- (event_id, status, created_at desc) stays for the review-queue read.
--
-- IDEMPOTENT: create unique index IF NOT EXISTS.
-- =====================================================================

create unique index if not exists rsvp_extractions_one_committed_per_transcript
  on public.rsvp_extractions (transcript_id)
  where status = 'committed';
