# 5-call test — record → Sarvam → call notes → review → Excel

Written 2026-09-26. The pipeline is already built; this is the checklist that gets
five real calls through it, plus the one code fix it needed.

## What exists (verified in the repo and the live project, 26 Sep 2026)

| Stage | State | Where |
|---|---|---|
| Dial + `call_attempts` row before `tel:` | Built | CallScreen, `src/lib/native/navigation.ts` |
| Recording captured by the phone's own dialer | Human gate (H0) | `docs/dry-run-h0-audio-check.md` |
| Harvest: find file, match by time, upload | Built | `CallRecordingHarvestPlugin.java`, `src/lib/harvest*.ts` |
| Unknown recordings tray | Built | `rsvp/unmatched` |
| Consent gate (no consent = never sent to Sarvam) | Built | harvest-upload + `transcribe-recording` |
| Webhook `call_recordings` -> `transcribe-recording` | **Fixed, applied, LIVE** | `20260926091112_fix_pipeline_webhooks.sql` |
| Sarvam transcription | **Fixed + deployed (v3), LIVE**; key verified with Sarvam | `supabase/functions/transcribe-recording` |
| Webhook `transcripts` -> `extract-rsvp` | **Restored + applied**; waits for extract Vault secrets | same migration |
| Extraction | Built; model id **fixed**; **needs an Anthropic key**, not deployed | `supabase/functions/extract-rsvp` |
| Review screen -> `apply_rsvp_extraction()` | Built | review queue |
| Excel export | Built | `src/lib/export/sheets.ts` |

### Three bugs fixed on 26 Sep, each of which alone stopped the pipeline

1. **Both database webhooks called `extensions.net.http_post`.** Postgres reads that as
   database.schema.function and errors on every call; the triggers swallow errors by design,
   so nothing was ever sent. Correct name is `net.http_post`. Migration
   `20260926091112_fix_pipeline_webhooks.sql` (applied to the live project).
2. **The extraction trigger did not exist on the live project**, though `20260812100000` is
   recorded as applied. Restored by the same migration.
3. **`extract-rsvp` used `claude-sonnet-4-20250514`, retired by Anthropic on 15 June 2026.**
   Every extraction call would fail. Now `claude-sonnet-4-6`, Anthropic's named replacement.

Plus the Sarvam fix below.

## The fix: Sarvam batch API

`transcribe-recording` posted the audio to `POST /speech-to-text`, Sarvam's synchronous endpoint.
That endpoint takes **at most 30 seconds of audio and does not diarize** (Sarvam docs, "Which API
to use"). Every real RSVP call is longer than 30 s, so every real call would have failed.

It now uses the batch job API (create → upload-files → PUT → start → status → download-files),
with `saaras:v3`, `mode: codemix`, `language_code: unknown`, diarization, 2 speakers. Paths and
fields were taken from Sarvam's official Python SDK, not guessed.

- The webhook gets `202` at once; the job runs as a background task (`EdgeRuntime.waitUntil`).
- The Sarvam job id is saved on the transcript row (`raw_response.sarvam_job_id`, `phase`)
  **before** the job starts. If the function stops waiting (120 s cap) the row stays
  `processing`; calling the function again for the same `recording_id` **resumes that job and
  bills nothing new**. `v_transcription_backlog` lists these rows.
- Unchanged: consent gate, <10 s skip, never re-bill a `complete` row, full payload kept in
  `raw_response`, `normalise()`, cost alert.

Verified offline with a fake Sarvam + fake Supabase: happy path, redelivery after complete,
deadline then resume (no second job), failed job, consent refused. `deno check` clean.
**Not yet verified against the real Sarvam API** — call 1 below is that test.

## Setup — DONE for transcription (26 Sep 2026)

Done from this session, no CLI needed:

- `transcribe-recording` **deployed** (version 3) with the batch fix.
- Secrets live in **Supabase Vault**, read by the function through
  `public.pipeline_secret()` (service role only; staff/client get "permission denied"):
  `sarvam_api_key`, `transcribe_webhook_secret` (generated inside the database, never shown),
  `transcribe_webhook_url`. Vault wins over any Edge Function secret of the same name — an
  old `TRANSCRIBE_WEBHOOK_SECRET` from August was 401-ing every call.
- Verified live: wrong secret → 401; non-consented recording → refused before any spend;
  Sarvam check → key accepted.
- **Rotate the Sarvam key** (it was pasted into a chat). New key in Sarvam's dashboard, then in
  the SQL Editor:
  ```sql
  select vault.update_secret((select id from vault.secrets where name = 'sarvam_api_key'), '<new key>');
  ```
  Takes effect within 5 minutes, no redeploy.

**Not done — extraction.** Needs an Anthropic key (or the DeepSeek decision). With a key, in
the SQL Editor:
```sql
select vault.create_secret('<anthropic key>', 'anthropic_api_key');
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'extract_webhook_secret');
select vault.create_secret('https://xktxnkuzplhzxkevwrcj.supabase.co/functions/v1/extract-rsvp', 'extract_webhook_url');
```
then `extract-rsvp` needs the same Vault read as `transcribe-recording` and a deploy. Until
then transcripts complete and wait in `v_extraction_backlog`; staff can still log the RSVP by
hand.

`scripts/setup-call-pipeline.ps1` is the CLI route to the same result; it is no longer needed
for transcription.

Check the setup any time (SQL Editor):
```sql
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'transcribe_webhook_url'),
  headers := jsonb_build_object('Content-Type','application/json','x-webhook-secret',
    (select decrypted_secret from vault.decrypted_secrets where name = 'transcribe_webhook_secret')),
  body := '{"check":"sarvam"}'::jsonb, timeout_milliseconds := 30000);
-- a few seconds later, with the id it returned:
select status_code, content from net._http_response where id = <id>;
-- expect "key_accepted": true
```

Then H0 on the test handset: `docs/dry-run-h0-audio-check.md`. Both voices must be audible in
the dialer's own recording, or stop here.

## The five calls

Only to people who agree to be recorded. Say the line at the start of every call:
**"यह कॉल रिकॉर्ड हो रही है — this call is being recorded for your event records."**

| # | Call | What it tests |
|---|---|---|
| C1 | English, quiet room, ~2 min | Batch job end to end (the first real Sarvam run) |
| C2 | Gujarati only | Auto language detection |
| C3 | Hindi–English mix with a flight number and a date | Numbers and dates survive codemix |
| C4 | Noisy, people talk over each other | Diarization; staff/guest swap in review |
| C5 | Callee says don't record | Nothing uploaded, nothing sent to Sarvam |

For each call write down:

| # | Harvested and matched to the right family? | Transcript status | Accuracy 1–5 (listen while reading) | Speakers right? | Fields right / wrong / missing | Invented fields (must be 0) | Minutes from hang-up to review item |
|---|---|---|---|---|---|---|---|
| C1 | | | | | | | |
| C2 | | | | | | | |
| C3 | | | | | | | |
| C4 | | | | | | | |
| C5 | | | | | | | |

Useful queries while testing (read-only):
```sql
select id, status, error_text, raw_response->>'sarvam_job_id' job, raw_response->>'phase' phase
  from transcripts order by created_at desc limit 5;
select * from v_transcription_backlog;
```
A row stuck in `processing` with a job id: invoke the function again with
`{"recording_id": "<id>"}` and the `x-webhook-secret` header — it resumes, it does not re-bill.

**Pass bar:** C1–C4 harvested and matched; C5 never reaches Sarvam; 0 invented fields;
average accuracy ≥ 4 on C1–C3; each review item shows evidence for every field.
Then export Excel from the app and check the reviewed values are there.

## Still open after the test

- Extraction model: the function calls Claude (`claude-sonnet-4-6`). The project note says
  DeepSeek was chosen on cost, pending five conditions. Decide before real guest calls.
- Nothing retries `processing` rows automatically; a pg_cron job over `v_transcription_backlog`
  would. Propose it only if the test shows jobs outliving the 120 s wait.
- Asking questions across calls (RAG) and scheduled deletion of old audio are not built.
- The 10 live non-consented `call_recordings` rows are still undecided (DECISIONS.md §6.1).
