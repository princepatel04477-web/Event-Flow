-- ---------------------------------------------------------------------
-- v_review_queue — every call that needs a human, transcribed or not.
--
-- IDEMPOTENT: create or replace view.
--
-- THE RULE THIS ENFORCES: the pipeline may fail, but a call must never
-- vanish. Every recorded call reaches a human.
--
-- Before this, the review screen read `rsvp_extractions where status =
-- 'pending'`. A failed transcription produces NO extraction row, so the call
-- was structurally invisible to the person who made it — not buried, absent.
-- The staff member dialled the family, had the conversation, and the outcome
-- was silently dropped. That is a dropped CALL, not a dropped transcript.
--
-- Two kinds of row come out of here:
--   'extraction'  — the normal path. An AI draft waiting for review.
--   'manual'      — the pipeline failed. Audio exists, no usable draft.
--                   She listens and types.
--
-- A recording qualifies as 'manual' when either:
--   * its transcript is 'failed' (terminal — Sarvam refused, too_short, or
--     retries exhausted), or
--   * it has no transcript row at all AND is older than 10 minutes.
--
-- Why 10 minutes: the webhook fires within seconds, so a gap that long means
-- the enqueue was lost (vault secrets missing, pg_net down, function cold-
-- start failure). Shorter and every recording would flash into the queue
-- during its own normal processing; longer and a lost call sits unnoticed
-- through most of a calling shift.
--
-- Deliberately NOT included: 'pending'/'processing' transcripts younger than
-- the threshold. Those are in flight and appearing in the review queue would
-- be noise. `v_transcription_backlog` is the ops view for those.
--
-- security_invoker = true, so staff RLS applies and a client login sees
-- nothing — consistent with v_rsvp_queue and v_transcription_backlog.
-- ---------------------------------------------------------------------

create or replace view public.v_review_queue
with (security_invoker = true) as

-- 1. The normal path: AI drafts waiting for a human.
select
  'extraction'::text        as kind,
  ex.id                     as item_id,
  ex.event_id,
  ex.group_id,
  ex.created_at             as waiting_since,
  null::uuid                as recording_id,
  null::text                as failure_reason,
  null::integer             as duration_sec
from public.rsvp_extractions ex
where ex.status = 'pending'

union all

-- 2. The failure path: a real call with no usable draft.
select
  'manual'::text            as kind,
  cr.id                     as item_id,
  cr.event_id,
  cr.group_id,
  cr.recorded_at            as waiting_since,
  cr.id                     as recording_id,
  coalesce(t.error_text, 'no_transcript') as failure_reason,
  cr.duration_sec
from public.call_recordings cr
left join public.transcripts t on t.recording_id = cr.id
where
  -- Terminal failure, or never picked up at all.
  -- Parenthesised deliberately: AND binds tighter than OR, so without these
  -- brackets the dedup below would apply to the second branch only and every
  -- failed transcript would list twice.
  (
    (t.id is not null and t.status = 'failed')
    or (t.id is null and cr.recorded_at < now() - interval '10 minutes')
  )
  -- Never double-list a call that already reached review as an extraction.
  -- Matched on THIS RECORDING, not on the group: a group can have several
  -- calls, and deduping by group would hide a failed second call whenever any
  -- other extraction for that family happened to be pending — which is
  -- exactly the disappearance this view exists to prevent.
  and not exists (
    select 1
    from public.rsvp_extractions ex2
    join public.transcripts t2 on t2.id = ex2.transcript_id
    where ex2.status = 'pending'
      and t2.recording_id = cr.id
  );

comment on view public.v_review_queue is
  'Everything awaiting human review: pending AI extractions (kind=extraction) '
  'plus calls whose transcription failed or never ran (kind=manual). A failed '
  'pipeline must never make a call disappear — manual rows carry the audio so '
  'the caller can listen and type the outcome by hand.';

grant select on public.v_review_queue to authenticated;
