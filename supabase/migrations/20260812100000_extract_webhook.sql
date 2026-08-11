-- ---------------------------------------------------------------------
-- Fire the extract-rsvp Edge Function when a transcript completes.
--
-- IDEMPOTENT: create extension / create or replace function / drop+create
-- trigger are all safe to re-run.
--
-- WHY THIS EXISTS
-- `extract-rsvp` has been deployable since `bef7dfc` and nothing has ever
-- called it. Grepping the repo, the string 'extract-rsvp' appeared only inside
-- the function's own source: no trigger, no client call site, and
-- `transcribe-recording` deliberately does not chain to it. So the pipeline
-- documented in CLAUDE.md §9 stopped dead at the transcript — audio was
-- transcribed and then sat there, and the review queue was fed only by manual
-- entry. This is the missing hop.
--
-- WHY AFTER UPDATE AND NOT AFTER INSERT
-- `transcribe-recording` claims its row BEFORE spending money on Sarvam: it
-- inserts with status 'pending' (and `text = ''`, the legacy NOT NULL column),
-- then updates to 'complete' when the transcript lands. Firing on insert would
-- always hit a pending row, and extract-rsvp rejects anything not complete
-- with a 400. The INSERT branch is kept anyway for the manual-entry path
-- (20260810130000), which can write a complete transcript in one statement.
--
-- WHY THE GUARD ON old.status
-- Any later update to a completed transcript — a re-run that rewrites
-- raw_response, an admin correction — must not bill another Claude call and
-- append a second extraction to the review queue. Only the transition INTO
-- 'complete' fires.
--
-- SETUP (once per project, in the SQL editor — NOT in this migration, because
-- migrations are committed to git and these are secrets):
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/extract-rsvp',
--                              'extract_webhook_url');
--   select vault.create_secret('<the same value as EXTRACT_WEBHOOK_SECRET>',
--                              'extract_webhook_secret');
--
-- and set the matching Edge Function secrets:
--
--   npx supabase secrets set ANTHROPIC_API_KEY=<key>
--   npx supabase secrets set EXTRACT_WEBHOOK_SECRET=<same value as above>
--
-- Until those exist the trigger raises a warning and does nothing; transcripts
-- still complete normally.
-- ---------------------------------------------------------------------

create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------------
-- The trigger function.
--
-- NEVER BLOCKS THE TRANSCRIPT. Same reasoning as app.enqueue_transcription():
-- a transcript with no extraction is recoverable — the backlog view below
-- finds it, and a human can enter the RSVP by hand from the transcript text.
-- A transcript that failed to save because extraction could not be queued has
-- thrown away work that cost ₹0.75 to produce.
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

    perform extensions.net.http_post(
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
