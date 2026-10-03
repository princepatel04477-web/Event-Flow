-- =====================================================================
-- Live call-log Excel: rebuild it whenever a call is recorded, transcribed,
-- extracted or reviewed.
--
-- app.enqueue_call_log() posts {event_id} to the call-log-excel Edge Function
-- through pg_net. Same shape and same guarantees as enqueue_transcription:
--   * never blocks the write (every error is swallowed into a WARNING),
--   * reads URL + secret from Vault (call_log_webhook_url /
--     call_log_webhook_secret) and does nothing if they are missing,
--   * net.http_post (NOT extensions.net.http_post — see 20260926091112).
--
-- Fires on:
--   call_recordings  AFTER INSERT                      -> row appears ("Transcribing")
--   transcripts      AFTER UPDATE OF status            -> transcript done / failed
--   rsvp_extractions AFTER INSERT OR UPDATE OF status, parsed -> AI draft, then "Checked"
-- Each fire rebuilds the whole file for that event (~hundreds of rows).
--
-- Also adds call_log_webhook_secret to the pipeline_secret() allow-list.
-- =====================================================================

create or replace function public.pipeline_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
   where ds.name = p_name
     and p_name in (
       'sarvam_api_key',
       'transcribe_webhook_secret',
       'anthropic_api_key',
       'extract_webhook_secret',
       'call_log_webhook_secret'
     )
   limit 1
$$;

revoke all on function public.pipeline_secret(text) from public;
revoke all on function public.pipeline_secret(text) from anon;
revoke all on function public.pipeline_secret(text) from authenticated;
grant execute on function public.pipeline_secret(text) to service_role;

create or replace function app.enqueue_call_log()
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
      from vault.decrypted_secrets where name = 'call_log_webhook_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'call_log_webhook_secret';

    if v_url is null or v_secret is null then
      raise warning 'enqueue_call_log: vault secrets missing; event % not rebuilt', new.event_id;
      return new;
    end if;

    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object(
                   'Content-Type',     'application/json',
                   'x-webhook-secret', v_secret
                 ),
      body    := jsonb_build_object('event_id', new.event_id),
      timeout_milliseconds := 5000
    );
  exception when others then
    raise warning 'enqueue_call_log failed for event %: %', new.event_id, sqlerrm;
  end;
  return new;
end;
$$;

comment on function app.enqueue_call_log() is
  'Rebuilds eventflow-exports/{event_id}/call-log-live.xlsx via the call-log-excel '
  'Edge Function. Swallows all errors; never blocks the triggering write.';

drop trigger if exists call_recordings_enqueue_call_log on public.call_recordings;
create trigger call_recordings_enqueue_call_log
  after insert on public.call_recordings
  for each row execute function app.enqueue_call_log();

drop trigger if exists transcripts_enqueue_call_log on public.transcripts;
create trigger transcripts_enqueue_call_log
  after update of status on public.transcripts
  for each row
  when (new.status is distinct from old.status)
  execute function app.enqueue_call_log();

drop trigger if exists rsvp_extractions_enqueue_call_log on public.rsvp_extractions;
create trigger rsvp_extractions_enqueue_call_log
  after insert or update of status, parsed on public.rsvp_extractions
  for each row execute function app.enqueue_call_log();
