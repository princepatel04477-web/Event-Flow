-- ---------------------------------------------------------------------
-- Fire the transcribe-recording Edge Function when a call recording lands.
--
-- IDEMPOTENT: create extension / create or replace function / drop+create
-- trigger are all safe to re-run.
--
-- WHY A DATABASE WEBHOOK AND NOT A DIRECT INVOKE FROM THE APP
-- The phone is the least reliable component in this system. A client-driven
-- invoke fires from the same handset that just lost signal mid-upload, so
-- "recording committed" and "transcription attempted" would routinely diverge
-- with nothing recording that a transcript was ever expected. This trigger
-- runs in the database, after the row is durably committed, so the two cannot
-- separate. There is also no app-side producer today — the M7 upload path is
-- unwired — so there is no call site a direct invoke could attach to.
--
-- SETUP (once per project, in the SQL editor — NOT in this migration, because
-- migrations are committed to git and these are secrets):
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/transcribe-recording',
--                              'transcribe_webhook_url');
--   select vault.create_secret('<the same value as TRANSCRIBE_WEBHOOK_SECRET>',
--                              'transcribe_webhook_secret');
--
-- and set the matching Edge Function secrets:
--
--   npx supabase secrets set SARVAM_API_KEY=<key>
--   npx supabase secrets set TRANSCRIBE_WEBHOOK_SECRET=<same value as above>
-- ---------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- The trigger function.
--
-- NEVER BLOCKS THE INSERT. A staff member is never blocked by this pipeline:
-- if the vault secrets are missing, pg_net is unavailable, or the HTTP enqueue
-- throws for any reason, the exception is swallowed and the recording still
-- commits. A recording with no transcript is recoverable (the sweeper below
-- picks it up, or it is entered by hand). A recording that failed to save
-- because transcription could not be queued is lost audio.
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

    perform extensions.net.http_post(
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
-- Recovery view: recordings that never got a transcript, or whose transcript
-- is stuck. Killing the function mid-run leaves a 'pending'/'processing' row;
-- this is how it is found and retried.
--
-- security_invoker = true, so normal staff RLS applies and a client login
-- sees nothing through it (consistent with v_rsvp_queue et al).
-- ---------------------------------------------------------------------
create or replace view public.v_transcription_backlog
with (security_invoker = true) as
select
  cr.id            as recording_id,
  cr.event_id,
  cr.group_id,
  cr.duration_sec,
  cr.recorded_at,
  t.id             as transcript_id,
  coalesce(t.status, 'missing') as status,
  t.error_text
from public.call_recordings cr
left join public.transcripts t on t.recording_id = cr.id
where t.id is null
   or t.status in ('pending', 'processing', 'failed');

comment on view public.v_transcription_backlog is
  'Recordings with no transcript, or one that is stuck/failed. A crash '
  'mid-run leaves a pending row; this is the retry work list.';
