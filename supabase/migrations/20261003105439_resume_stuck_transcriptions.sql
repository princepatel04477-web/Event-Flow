-- Recovered 2026-10-25 from supabase_migrations.schema_migrations on the Seoul
-- archive (xktxnkuzplhzxkevwrcj), where it was applied outside the repo. The body
-- below is the stored statement, unchanged. EventFlow-IN (Mumbai) has the
-- version recorded as applied and the cron job re-created by hand, so this file
-- exists so `db push` stops refusing; it does not need to run again there.

-- A Sarvam batch job can sit in its queue longer than one edge-function
-- invocation may wait (120s). The job id is saved on the transcript row, and
-- re-invoking transcribe-recording with the same recording_id resumes polling
-- that SAME job at no extra cost - but nothing re-invoked it, so a slow job left
-- the call stuck in 'processing' forever. This re-pokes them every 2 minutes.
--
-- Only rows that cannot cause a second bill are poked: a started job (resume),
-- or a 'pending' row that never reached Sarvam. Rows older than 1 day are left
-- alone (something else is wrong; they show in v_transcription_backlog).

create extension if not exists pg_cron;

create or replace function app.resume_stuck_transcriptions()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_url    text;
  v_secret text;
  v_count  integer := 0;
  r        record;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'transcribe_webhook_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'transcribe_webhook_secret';
  if v_url is null or v_secret is null then
    return 0;
  end if;

  for r in
    select t.recording_id
      from public.transcripts t
     where t.created_at > now() - interval '1 day'
       and t.created_at < now() - interval '2 minutes'
       and (
             (t.status = 'processing' and t.raw_response->>'phase' = 'started')
          or  t.status = 'pending'
           )
     order by t.created_at
     limit 20
  loop
    perform net.http_post(
      url     := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
      body    := jsonb_build_object('recording_id', r.recording_id),
      timeout_milliseconds := 5000
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function app.resume_stuck_transcriptions() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'resume-stuck-transcriptions';
select cron.schedule('resume-stuck-transcriptions', '*/2 * * * *', $$select app.resume_stuck_transcriptions()$$);

