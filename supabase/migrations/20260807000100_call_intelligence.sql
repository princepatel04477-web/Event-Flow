-- =====================================================================
-- 1700 CALL-INTELLIGENCE (A0)
--
-- Extends the Phase-1 call chain (call_recordings -> transcripts ->
-- rsvp_extractions) to the richer A0 shape, and adds the human-review
-- audit table. This is an EXPAND-IN-PLACE migration: the 0200 tables are
-- live (referenced by database.types.ts, the review screens, and
-- apply_rsvp_extraction / save_rsvp_log), so nothing is dropped or
-- renamed. New columns and states are added alongside the old; old
-- consumers keep compiling.
--
-- WHAT CHANGES:
--   * call_recordings  + consent_given (A2's per-call consent gate),
--                       + INSERT-ONLY (block_mutation trigger, the proven
--                         delivery_proofs pattern). Existing columns
--                         group_id / uploaded_by / recorded_at already
--                         satisfy A0's guest_group_id / recorded_by /
--                         created_at.
--   * transcripts      + raw_response, segments, detected_languages,
--                         full_text, status, error_text,
--                         + unique (recording_id) — one transcript per
--                         recording (0200 allowed many).
--   * rsvp_extractions + model_version, prompt_version, fields,
--                         overall_confidence (A0's "extractions" table;
--                         kept under its live name). app.extraction_status
--                         enum gains 'draft' | 'in_review' | 'committed'
--                         WITHOUT removing the live 'pending' | 'accepted'
--                         | 'rejected' | 'superseded' values that the
--                         review screens and apply_rsvp_extraction() use.
--   * extraction_field_reviews  NEW, insert-only — the per-field human
--                         sign-off audit trail and A6's correction corpus.
--
-- A0's column comment on extractions.fields documents the evidence
-- contract (evidence MUST be a verbatim substring of full_text).
--
-- IDEMPOTENCY: every statement is safe to re-run. Columns with IF NOT
-- EXISTS, enum values inside DO blocks (CREATE TYPE has no IF NOT EXISTS),
-- triggers with DROP IF EXISTS + CREATE, policies via the repo's
-- apply_staff_policies() helper. This migration is pushed repeatedly over
-- a live database.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENUM: extend app.extraction_status with the A0 lifecycle states.
--    'pending' | 'accepted' | 'rejected' | 'superseded' are kept — the
--    review screens read 'pending' and apply_rsvp_extraction() reads
--    'accepted' / 'rejected'. A0's states are added, not substituted.
-- ---------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_enum
                 where enumlabel = 'draft'
                   and enumtypid = 'app.extraction_status'::regtype) then
    alter type app.extraction_status add value 'draft';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum
                 where enumlabel = 'in_review'
                   and enumtypid = 'app.extraction_status'::regtype) then
    alter type app.extraction_status add value 'in_review';
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_enum
                 where enumlabel = 'committed'
                   and enumtypid = 'app.extraction_status'::regtype) then
    alter type app.extraction_status add value 'committed';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. CALL_RECORDINGS — consent gate + INSERT-ONLY.
-- ---------------------------------------------------------------------
alter table public.call_recordings
  add column if not exists consent_given boolean not null default false;

comment on column public.call_recordings.consent_given is
  'A2 per-call consent. The guest was read the disclosure script and agreed. '
  'FALSE by default; no recording row exists without an explicit TRUE. '
  'Consent refused -> no recording is created and the call is logged by hand.';

comment on column public.call_recordings.storage_path is
  'Object key in the call-recordings bucket, always '
  '{event_id}/{group_id}/{uuid}.aac — the bucket policy reads the first '
  'path segment as the tenant key and rejects any other shape.';

-- INSERT-ONLY, exactly the delivery_proofs pattern: an unconditional
-- trigger that fires even for the service role (which bypasses RLS), so a
-- recording can never be edited or deleted once committed.
drop trigger if exists call_recordings_no_update on public.call_recordings;
create trigger call_recordings_no_update
  before update on public.call_recordings
  for each row execute function app.block_mutation();

drop trigger if exists call_recordings_no_delete on public.call_recordings;
create trigger call_recordings_no_delete
  before delete on public.call_recordings
  for each row execute function app.block_mutation();

-- ---------------------------------------------------------------------
-- 3. TRANSCRIPTS — richer shape. One transcript per recording.
-- ---------------------------------------------------------------------
alter table public.transcripts
  add column if not exists raw_response jsonb,
  add column if not exists full_text text,
  add column if not exists segments jsonb,
  add column if not exists detected_languages text[],
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'failed')),
  add column if not exists error_text text;

comment on column public.transcripts.raw_response is
  'The FULL Sarvam payload, never trimmed. STT is irreversible and costs '
  '~₹0.75/call; re-running extraction costs ~₹0.03. Keeping the raw payload '
  'means the extraction prompt can iterate without ever re-billing STT.';

comment on column public.transcripts.segments is
  '[{speaker, start_ms, end_ms, text}] with word-level timestamps. Speaker '
  'labels are mapped to staff|guest by the worker; the first speaker is '
  'assumed staff (they placed the call) and the assumption is recorded in '
  'segment metadata so review can correct it.';

comment on column public.transcripts.full_text is
  'The canonical transcript text. extractions.fields.evidence MUST be a '
  'verbatim substring of this column — the review UI string-searches it.';

comment on column public.transcripts.status is
  'Worker lifecycle. pending = row inserted before STT so a crash mid-run '
  'is visible; the worker retries pending rows. A terminal failed status '
  'still lands the call in the review queue for manual entry.';

-- The 0200 index on (event_id, recording_id) stays. The A0 contract is
-- one transcript per recording, enforced by a unique index on recording_id
-- (recording_id is already NOT NULL in 0200).
create unique index if not exists transcripts_recording_id_uq
  on public.transcripts (recording_id);

-- ---------------------------------------------------------------------
-- 4. RSVP_EXTRACTIONS — A0's "extractions" table, extended in place.
-- ---------------------------------------------------------------------
alter table public.rsvp_extractions
  add column if not exists model_version text,
  add column if not exists prompt_version text,
  add column if not exists fields jsonb,
  add column if not exists overall_confidence text
    check (overall_confidence in ('high', 'medium', 'low'));

comment on column public.rsvp_extractions.fields is
  'Per-field extraction result. Shape:
     { "arrival_time": {
         "value": "10:30",
         "confidence": "high",
         "evidence": "साढ़े दस बजे",
         "evidence_start_ms": 45200,
         "evidence_end_ms": 47100,
         "reasoning": "saade das = 10:30, subah stated"
       }, ... }
   evidence MUST be a verbatim substring of transcripts.full_text — the
   review UI string-searches it to scroll + scrub to the source.';

comment on column public.rsvp_extractions.overall_confidence is
  '"low" if ANY of rsvp_status / arrival_date / arrival_time is low. '
  'Drives the review queue sort (low first).';

-- Exactly one committed extraction per transcript: a partial unique index
-- on transcript_id where status = ''committed''. The 0200 index on
-- (event_id, status, created_at desc) stays for the queue read.
--
-- NOTE: this index's predicate uses the enum value 'committed', which this
-- migration adds. Postgres forbids using a just-added enum value in the
-- same transaction (SQLSTATE 55P04), so the index lives in migration
-- 20260807000101_call_intelligence_idx.sql, which runs as its own
-- transaction after the value is committed.
--

-- ---------------------------------------------------------------------
-- 4b. RSVP_EXTRACTIONS — add unique (id, event_id) so child tables can
--     use the repo's composite-FK tenancy pattern (CLAUDE.md §5.1). 0200
--     defined the table with a bare id PK; the new child table below
--     needs the (id, event_id) target.
-- ---------------------------------------------------------------------
alter table public.rsvp_extractions
  drop constraint if exists rsvp_extractions_id_event_id_uq;
alter table public.rsvp_extractions
  add constraint rsvp_extractions_id_event_id_uq unique (id, event_id);

-- ---------------------------------------------------------------------
-- 5. EXTRACTION_FIELD_REVIEWS — the human sign-off audit trail.
--    INSERT-ONLY, same pattern as delivery_proofs. This is also the
--    correction corpus A6 retrieves from.
-- ---------------------------------------------------------------------
create table if not exists public.extraction_field_reviews (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  extraction_id uuid not null,
  field_name    text not null,

  ai_value      jsonb,
  final_value   jsonb,
  action        text not null check (action in ('accepted', 'edited', 'rejected')),

  reviewed_by   uuid references auth.users (id),
  created_at    timestamptz not null default now(),

  unique (id, event_id),
  foreign key (extraction_id, event_id)
    references public.rsvp_extractions (id, event_id) on delete cascade
);

create index if not exists extraction_field_reviews_extraction_idx
  on public.extraction_field_reviews (event_id, extraction_id);

comment on table public.extraction_field_reviews is
  'One row per reviewed field, proving a human signed off on every value '
  'that entered guest data. Both ai_value and final_value are stored, so an '
  'edit is auditable and the correction corpus (action = ''edited'') is '
  'reusable. INSERT-ONLY — rows are never mutated.';

drop trigger if exists extraction_field_reviews_no_update on public.extraction_field_reviews;
create trigger extraction_field_reviews_no_update
  before update on public.extraction_field_reviews
  for each row execute function app.block_mutation();

drop trigger if exists extraction_field_reviews_no_delete on public.extraction_field_reviews;
create trigger extraction_field_reviews_no_delete
  before delete on public.extraction_field_reviews
  for each row execute function app.block_mutation();

select app.attach_standard_triggers('public.extraction_field_reviews');

-- ---------------------------------------------------------------------
-- 6. RLS.
--
--    call_recordings + extraction_field_reviews are INSERT-ONLY tables.
--    They get the delivery_proofs pattern exactly: select + insert
--    policies only, and revoke update/delete from authenticated, so RLS
--    denies the mutation even before the trigger fires (belt and braces).
--    The trigger is the fence that also holds against the service role.
--
--    transcripts + rsvp_extractions keep the staff policy set they ALREADY
--    have from migration 0500 (its apply_staff_policies list includes both).
--    They legitimately need UPDATE: the worker moves transcripts through
--    pending/processing/complete/failed, and the review flow commits
--    rsvp_extractions. A client login reads zero rows from all four — the
--    sel policies gate on app.is_staff(event_id).
--
--    call_recordings' 0500 policies granted UPDATE/DELETE to staff/admin.
--    This migration DROPS those and replaces them with insert-only, so the
--    table matches delivery_proofs at both the RLS and trigger levels.
-- ---------------------------------------------------------------------
alter table public.call_recordings enable row level security;
alter table public.call_recordings force row level security;

drop policy if exists call_recordings_sel on public.call_recordings;
create policy call_recordings_sel on public.call_recordings for select to authenticated
  using (app.is_staff(event_id));

drop policy if exists call_recordings_ins on public.call_recordings;
create policy call_recordings_ins on public.call_recordings for insert to authenticated
  with check (app.is_staff(event_id));

drop policy if exists call_recordings_upd on public.call_recordings;
drop policy if exists call_recordings_del on public.call_recordings;

revoke update, delete on public.call_recordings from authenticated;

alter table public.extraction_field_reviews enable row level security;
alter table public.extraction_field_reviews force row level security;

drop policy if exists extraction_field_reviews_sel on public.extraction_field_reviews;
create policy extraction_field_reviews_sel on public.extraction_field_reviews for select to authenticated
  using (app.is_staff(event_id));

drop policy if exists extraction_field_reviews_ins on public.extraction_field_reviews;
create policy extraction_field_reviews_ins on public.extraction_field_reviews for insert to authenticated
  with check (app.is_staff(event_id));

revoke update, delete on public.extraction_field_reviews from authenticated;
