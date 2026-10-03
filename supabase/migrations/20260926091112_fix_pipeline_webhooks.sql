-- =====================================================================
-- FIX the two pipeline webhooks. Both have been silently dead since August.
--
-- 1. WRONG FUNCTION NAME. app.enqueue_transcription() (20260810120000) and
--    app.enqueue_extraction() (20260812100000) call
--        extensions.net.http_post(...)
--    Postgres reads a three-part function name as database.schema.function,
--    so this raises "cross-database references are not implemented" on every
--    call. Both functions wrap the call in `exception when others` (by
--    design: an enqueue failure must never block the insert), so the error
--    became a WARNING and nothing was ever sent. pg_net installs http_post in
--    schema `net` regardless of the extension's own schema; the call is
--    net.http_post. Verified on the live project 2026-09-26:
--        explain select extensions.net.http_post(url := 'https://x')
--        -> ERROR 0A000 cross-database references are not implemented
--        select nspname ... where proname = 'http_post'  -> net
--
-- 2. MISSING EXTRACTION TRIGGER. The live project lists 20260812100000 as
--    applied, but app.enqueue_extraction(), both
--    transcripts_enqueue_extraction_* triggers and v_extraction_backlog do
--    not exist. Completed transcripts never reached extract-rsvp.
--
-- Everything below is the original function/trigger/view text with ONLY the
-- http_post call corrected. All statements are idempotent.
--
-- Still inert until the Vault holds transcribe_webhook_url/_secret and
-- extract_webhook_url/_secret (see docs/CALL-5-TEST.md) — the functions
-- raise a warning and return when a secret is missing, exactly as before.
-- =====================================================================

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- 1. Transcription enqueue (call_recordings -> transcribe-recording)
-- ---------------------------------------------------------------------
create or replace function app.enqueue_transcription()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'transcribe_webhook_url';

    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'transcribe_webhook_secret';

    if v_url is null or v_secret is null then
      raise warning 'enqueue_transcription: vault secrets missing; recording % not queued', new.id;
      return new;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type',     'application/json',
                   'x-webhook-secret', v_secret
                 ),
      body    := jsonb_build_object('recording_id', new.id),
      timeout_milliseconds := 5000   -- enqueue only; the function runs async
    );
  exception when others then
    -- Swallow deliberately. See the note above: losing the audio is worse
    -- than losing the automatic transcription trigger.
    raise warning 'enqueue_transcription failed for recording %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function app.enqueue_transcription() is
  'AFTER INSERT on call_recordings: enqueues the transcribe-recording Edge '
  'Function via pg_net. Swallows all errors — a failure here must never block '
  'the recording insert.';

drop trigger if exists call_recordings_enqueue_transcription on public.call_recordings;
create trigger call_recordings_enqueue_transcription
  after insert on public.call_recordings
  for each row execute function app.enqueue_transcription();


-- ---------------------------------------------------------------------
-- 2. Extraction enqueue (transcripts -> extract-rsvp), restored
-- ---------------------------------------------------------------------
create or replace function app.enqueue_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url
      from vault.decrypted_secrets where name = 'extract_webhook_url';

    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'extract_webhook_secret';

    if v_url is null or v_secret is null then
      raise warning 'enqueue_extraction: vault secrets missing; transcript % not queued', new.id;
      return new;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type',     'application/json',
                   'x-webhook-secret', v_secret
                 ),
      body    := jsonb_build_object('transcript_id', new.id),
      timeout_milliseconds := 5000   -- enqueue only; the function runs async
    );
  exception when others then
    -- Swallow deliberately. See the note above: losing the transcript is worse
    -- than losing the automatic extraction trigger.
    raise warning 'enqueue_extraction failed for transcript %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

comment on function app.enqueue_extraction() is
  'Fires when a transcript reaches status = complete: enqueues the extract-rsvp '
  'Edge Function via pg_net. Swallows all errors — a failure here must never '
  'block the transcript write.';

drop trigger if exists transcripts_enqueue_extraction_ins on public.transcripts;
create trigger transcripts_enqueue_extraction_ins
  after insert on public.transcripts
  for each row
  when (new.status = 'complete')
  execute function app.enqueue_extraction();

drop trigger if exists transcripts_enqueue_extraction_upd on public.transcripts;
create trigger transcripts_enqueue_extraction_upd
  after update of status on public.transcripts
  for each row
  when (new.status = 'complete' and old.status is distinct from 'complete')
  execute function app.enqueue_extraction();

-- ---------------------------------------------------------------------
-- Recovery view: transcripts that completed but produced no extraction.
--
-- The sibling of v_transcription_backlog, and the reason the trigger is
-- allowed to fail silently — everything it drops is visible here.
--
-- security_invoker = true, so normal staff RLS applies and a client login
-- sees nothing through it (consistent with v_rsvp_queue et al).
-- ---------------------------------------------------------------------
create or replace view public.v_extraction_backlog
with (security_invoker = true) as
select
  t.id           as transcript_id,
  t.event_id,
  cr.group_id,
  t.recording_id,
  t.created_at   as transcribed_at,
  length(coalesce(t.full_text, t.text, '')) as transcript_chars
from public.transcripts t
join public.call_recordings cr on cr.id = t.recording_id
left join public.rsvp_extractions e on e.transcript_id = t.id
where t.status = 'complete'
  and e.id is null;

comment on view public.v_extraction_backlog is
  'Completed transcripts with no rsvp_extractions row — the extraction retry '
  'work list. A transcript here means Claude was never asked, not that it '
  'answered badly.';
