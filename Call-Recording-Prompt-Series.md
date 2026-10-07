# EventFlow — Call Recording → Transcript → Call Notes → Excel Prompt Series

For **Qwen 3.8 (Max or 27B)** in Claude Code / Cursor / Antigravity against `C:\dev\EventFlow`.

Run **one prompt per session, in order. Commit between each.** Every prompt is narrow on
purpose — Qwen 3.8 27B tends to over-deliberate when the scope is wide.

**Goal of this series:** get 5 real calls from dial → recording → Sarvam transcript →
DeepSeek call notes (human-reviewed) → Excel, legally. RAG and retention come after the
5-call test passes.

**Minimum path for the 5-call test:** P0 → P1 → P2 → P3 → P4 → P5 → P6 → P9.
P7 (RAG) and P8 (retention + erasure) come after.

**Before you start:**
- Put the Sarvam key in `.env.local` as `SARVAM_API_KEY` and in Supabase secrets
  (`supabase secrets set SARVAM_API_KEY=...`). Never paste it into a chat or a prompt.
- Make the 5 test calls only to people who agree to be recorded (your own team first).

---

## PREAMBLE — paste this at the top of every prompt, replacing `[PREAMBLE]`

```
You are working in the EventFlow repo (C:\dev\EventFlow). Read CLAUDE.md first; its rules
override anything below.

STACK: Next.js 16 (src/proxy.ts, not middleware.ts), TypeScript, Tailwind, shadcn/ui,
Supabase (Postgres 16, RLS, Edge Functions, Storage, pg_cron), TanStack Query, Dexie,
SheetJS for Excel, Capacitor Android WebView shell. LLM extraction: DeepSeek platform API.
Speech-to-text: Sarvam AI.

HARD RULES:
- Every table is fenced by event_id. RLS is enforced in Postgres, never only in the app.
  Roles: admin (all events), event_team (one event), client (read-only).
- Schema changes go ONLY in supabase/migrations/. Write the migration, show it to me, and
  STOP. Do not apply it until I say "apply".
- No service-role writes from local scripts. Edge Functions may use the service role but
  must scope every write by the event_id of the row they were called for.
- AI output is evidence, not authority. Nothing produced by Sarvam or DeepSeek ever writes
  to guest, group, room or travel records. It goes to the review queue; a human commits.
- No `any` types. No console.log in production code. No placeholders or TODO stubs — if
  something cannot be finished, stop and tell me why.
- Never invent API fields. For Sarvam and DeepSeek, open the official docs page named in
  the prompt, quote the exact request/response fields you will use in your first reply,
  and only then write code.
- One concern per commit. Do not touch files outside "Files you may change".
- Be brief in your reasoning. If you are unsure between two options, stop and ask me
  instead of deliberating.

When done, reply with: what changed (file list), how you verified it, and anything you
could not verify.
```

---

# PROMPT 0 — Map what already exists

```
[PREAMBLE]

TASK: Before building anything, find out what call/recording code this repo already has.
The repo already contains call screens (call/[groupId], rsvp/call/[groupId]), an unknown-
numbers screen (calls/unmatched, rsvp/unmatched), a review queue (review/[extractionId])
and the words "harvest" and "extraction" — so part of this pipeline exists.

DO:
1. Find every file, table, migration, Edge Function, storage bucket and env var related to:
   calls, recordings, harvest, unmatched numbers, Sarvam, DeepSeek, extraction, review
   queue, Excel export. Use grep over src/, supabase/, android/ and docs/.
2. For each pipeline stage below, mark it DONE / PARTIAL / MISSING, with the file(s) that
   prove it:
     S1 Dial from the app and log the call attempt (who, which family, number, time)
     S2 Recording captured on the handset (native dialer auto-record)
     S3 Harvest: recording found on the handset, uploaded, matched to a call row
     S4 Unknown numbers queue for recordings that do not match
     S5 Sarvam transcription (batch, with speaker separation)
     S6 DeepSeek extraction into call notes
     S7 Human review queue
     S8 Excel export of reviewed call notes
     S9 Consent: notice, spoken announcement, opt-out
     S10 Retention and erasure
3. List the open conditions from CLAUDE.md / DECISIONS.md that gate DeepSeek extraction
   and Sarvam script mode, and say which are still open.

Write the result to docs/CALL-PIPELINE.md: one table (stage | status | files | gap) and
a short list of what the next prompts must NOT rebuild because it already exists.

Files you may change: docs/CALL-PIPELINE.md (new). Nothing else.

Done when: docs/CALL-PIPELINE.md exists, every DONE/PARTIAL row names a real file, and
`git status` shows no other change.
```

> **Read the P0 report before running P1.** If a stage is already DONE, skip or trim the
> matching prompt. If P0 shows your harvest works differently from what P3 assumes, tell
> the agent in P3.

---

# PROMPT 1 — Data model for calls, recordings and consent

```
[PREAMBLE]

TASK: Write ONE migration that gives the pipeline a complete, event-fenced data model.
Extend existing tables found in docs/CALL-PIPELINE.md instead of creating duplicates.

NEEDED (adapt names to what exists):
1. call row: id, event_id, group_id (nullable), dialed_by (user id), to_number (E.164),
   started_at, ended_at, duration_sec,
   recording_status enum: 'expected' | 'harvested' | 'unmatched' | 'opted_out' | 'deleted',
   announced boolean default false (staff confirmed they read the recording line),
   opted_out_at timestamptz null.
2. recording: call_id, event_id, storage_path, mime_type, bytes, sha256 (unique per event,
   so the same file is never uploaded twice), harvested_at, audio_delete_after timestamptz.
3. transcript: call_id, event_id, provider ('sarvam'), provider_job_id, model, language,
   status enum: 'queued' | 'running' | 'done' | 'failed', error text, full_text,
   segments jsonb (speaker, start_sec, end_sec, text), created_at, completed_at.
4. Reuse the existing extraction / review-queue table for call notes. If one does not
   exist, STOP and tell me — do not invent it here.
5. A private storage bucket `call-recordings` with object paths
   {event_id}/{call_id}.{ext}. Storage policies: event_team and admin of that event may
   read; nobody may read via a public URL; clients may never read.
6. RLS on every new table: admin all; event_team read/insert/update for their event only;
   client no access to recordings or transcripts.
7. Indexes: (event_id, started_at), (event_id, to_number), transcript(status).

Also write a SQL test file under supabase/tests/ proving: an event_team user of event A
cannot read event B's calls, recordings or transcripts, and a client cannot read any.

Files you may change: one new file in supabase/migrations/, one new file in
supabase/tests/, src/types/ (regenerated database types only), DECISIONS.md.

Done when: you have shown me the migration and STOPPED. After I say "apply": it applies on
`supabase db reset` locally, the RLS tests pass, and types are regenerated.
```

---

# PROMPT 2 — Call screen: announce, opt-out, log the attempt

```
[PREAMBLE]

TASK: Make the existing call screen legally safe and make every call matchable later.
The callee gets a normal phone call from the handset's own dialer (tel: link). Recording
is done by the handset's built-in dialer auto-record. The app cannot play an automatic
announcement, so the staff member says it.

BUILD, inside the existing call screen (the canonical one per src/lib/sections/config.tsx):
1. Before dialing, create the call row (recording_status 'expected', started_at now,
   to_number normalised to E.164, group_id, dialed_by). Then open tel:.
2. While on the call screen, show one fixed line the staff member reads out at the start,
   in the event's language setting (Gujarati / Hindi / English):
   "This call is being recorded for your event records."
   Plus a checkbox "I said the recording line" -> sets announced = true.
3. A "Don't keep the recording" button -> sets recording_status 'opted_out' and
   opted_out_at. It must be reachable during and after the call with one tap.
4. On return from the dialer (Capacitor app resume), prompt for ended state and set
   ended_at. Do not block the user if they skip it.
5. Writes go through TanStack Query with optimistic update + rollback, and work offline
   via the existing Dexie queue. Reuse SyncChip to show saved-on-phone vs saved.

Copy rules: follow docs/UX-RULES.md and docs/GLOSSARY.md if they exist. Buttons are verb +
object. Targets >= 44px.

Read first: the canonical call screen, src/lib/sections/config.tsx, the existing offline
write path in src/lib/ (grep for Dexie), src/components/ui/SyncChip.tsx.

Files you may change: the canonical call screen and its _components, one new file under
src/lib/calls/, DECISIONS.md.

Done when: tapping Call creates exactly one call row before the dialer opens (verify in
the DB), opt-out works offline and syncs later, typecheck + lint + tests pass.
```

---

# PROMPT 3 — Harvest: handset recording → private storage → matched call

```
[PREAMBLE]

TASK: Get the dialer's recording file off the handset and attach it to the right call row.
If docs/CALL-PIPELINE.md says S3 is DONE or PARTIAL, EXTEND that code; do not rebuild.

BUILD:
1. The user picks the dialer's recordings folder ONCE with the Android folder picker
   (Storage Access Framework). Persist the grant. Do not request MANAGE_EXTERNAL_STORAGE.
   Store the folder URI with @capacitor/preferences, not localStorage.
2. On app resume and on a "Import recordings" button: list files newer than the last
   harvest, compute sha256, skip any sha already uploaded for this event.
3. Match each file to a call row of this event: same phone number if the filename or
   metadata carries it, otherwise file time within [started_at - 2 min, started_at + 2 h]
   for calls dialed from THIS handset by THIS user. Exactly one candidate -> match.
   Zero or more than one -> recording_status 'unmatched', goes to the unknown-numbers
   screen for a human to assign. Never guess between two candidates.
4. If the matched call is 'opted_out': do NOT upload. Mark it done so it is never picked
   up again.
5. Upload to call-recordings/{event_id}/{call_id}.{ext} with the user's own session (not
   service role). Insert the recording row with audio_delete_after = now() + 90 days.
   Set call.recording_status 'harvested'.
6. Uploads resume after network loss; a half-uploaded file never produces a recording row.

H0 GATE (from the roadmap): add a "Test this phone" action that takes the newest harvested
recording and plays it back in the app. Record per-handset pass/fail in DECISIONS.md. Do
not let a handset's recordings go to transcription until it has passed once.

Files you may change: src/lib/native/ (harvest only), src/lib/calls/, the unknown-numbers
screen, android/ only if a plugin permission is required (explain why), DECISIONS.md.

Done when: on a real handset, a test call's recording appears in storage under the right
call row within one resume, a repeat import uploads nothing, an opted-out call uploads
nothing, and the H0 playback works. State clearly which of these you verified on a device
and which only in code.
```

---

# PROMPT 4 — Sarvam batch transcription

```
[PREAMBLE]

TASK: Transcribe harvested recordings with Sarvam's BATCH speech-to-text API, with
speaker separation. Real calls are too long for the instant REST endpoint.

FIRST, read these pages and quote in your first reply the exact endpoints, request fields,
job states, output format and limits you will use. Do not write code before that:
  https://docs.sarvam.ai/api-reference-docs/api-guides-tutorials/speech-to-text/batch-api
  https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/which-api-to-use
  https://docs.sarvam.ai/api/getting-started/models/saarika
Use the model the docs list as current for transcription in the original language (not
translation). Confirm the "script mode" question listed as open in CLAUDE.md and record
the answer in DECISIONS.md.

BUILD:
1. Supabase Edge Function `transcribe-start`: for a call with recording and no transcript,
   create a transcript row (queued), create the Sarvam batch job with speaker separation
   on, upload the audio from storage, start the job, save provider_job_id, set running.
   Language: the event's language setting, or auto-detect if the docs support it for
   mixed Gujarati/Hindi/English — say which you chose and why.
2. Edge Function `transcribe-poll`, run by pg_cron every minute: for running transcripts,
   check job status; on success download the output, write full_text and segments
   (speaker, start_sec, end_sec, text), set done; on failure write the error, set failed.
   Retry a failed job at most 2 times with backoff, then leave it failed and visible.
3. A trigger or the harvest step calls transcribe-start when a recording is inserted, only
   if the handset passed H0.
4. SARVAM_API_KEY is read only from Edge Function secrets. It must never reach the
   browser, the APK, a log line, or an error message shown to a user.
5. On the call detail screen: transcript status, and when done, the transcript as
   speaker-labelled turns with timestamps.

Files you may change: supabase/functions/transcribe-start/, supabase/functions/
transcribe-poll/, one migration for the pg_cron schedule (show it and STOP before apply),
the call detail screen, DECISIONS.md.

Done when: one real recording goes from harvested to done with speaker-labelled segments,
a forced failure (bad job id) ends in 'failed' with a readable error, and grep proves
SARVAM_API_KEY appears nowhere under src/ or android/.
```

---

# PROMPT 5 — DeepSeek call notes into the review queue

```
[PREAMBLE]

TASK: Turn each finished transcript into structured call notes that a human reviews.
Extraction is evidence, not authority: it creates review items, never edits guest data.

FIRST: check the five DeepSeek conditions listed in CLAUDE.md / DECISIONS.md. List which
are met. If server-side guards or the data-retention check are not met, STOP and tell me.
Read the DeepSeek API docs for JSON output mode and quote the fields you will use.

BUILD:
1. A Zod schema in src/lib/calls/callNotes.ts. Fields (all nullable; every non-null value
   carries `evidence`: the transcript segment index + quoted words it came from):
     rsvp_status: 'coming' | 'not_coming' | 'maybe'
     headcount: integer
     member_names: string[]
     arrival: { date, time, mode: 'flight'|'train'|'road', number, from_city }
     departure: same shape
     room_needs: string
     dietary: string
     follow_up: { needed: boolean, when, what }
     summary: string (max 2 sentences, in English)
2. Edge Function `extract-call-notes`, triggered when a transcript becomes done: send the
   segments with speaker labels, get JSON, validate with Zod. Validate flight/train
   number formats. Invalid output -> one retry with the validation error included -> then
   mark failed. Any field without evidence is dropped, not guessed.
3. Write the result to the EXISTING review queue as a proposal linked to the call and the
   group. The review screen shows each field next to its quoted evidence with Accept /
   Edit / Reject. Only Accept writes to guest records, through the existing commit path.
4. Sort review items so the fields most likely to be wrong (numbers, dates, flight/train)
   come first — this is one of the open conditions.

Files you may change: src/lib/calls/, supabase/functions/extract-call-notes/, the review
screen and its _components, DECISIONS.md.

Done when: one real transcript produces a review item whose every field shows evidence,
rejecting it changes no guest record, accepting it changes exactly the accepted fields,
and a transcript with no travel talk produces null travel fields (not invented ones).
```

---

# PROMPT 6 — Excel export of call notes

```
[PREAMBLE]

TASK: Export reviewed call notes to Excel with SheetJS, alongside the existing exports in
src/lib/export/.

BUILD:
1. One sheet "Calls": family, phone (last 4 digits only unless the user is admin), called
   by, date/time, duration, recording kept (yes / opted out), RSVP, headcount, arrival,
   departure, room needs, dietary, follow-up, summary, review status.
2. Only ACCEPTED values are exported as data. Pending proposals appear in a separate
   "Waiting for review" sheet so nobody mistakes an AI guess for a confirmed fact.
3. Keep the client's existing column vocabulary where a matching column already exists in
   the other exports (e.g. PAX).
4. Filters: date range, called by, review status. Event-fenced like every other export.
5. No transcript text and no audio links in the file.

Files you may change: src/lib/export/ (one new module), the export screen, DECISIONS.md.

Done when: the export for the test event opens in Excel with both sheets, accepted and
pending values are never mixed, and an event_team user of another event gets nothing.
```

---

# PROMPT 7 — RAG over transcripts (after the 5-call test passes)

```
[PREAMBLE]

TASK: Let staff ask questions across all calls of an event, e.g. "who said they need a
wheelchair?", with answers that cite the call and the quoted words.

BUILD:
1. Migration (show it and STOP): enable pgvector; table transcript_chunks(id, event_id,
   call_id, segment_from, segment_to, text, embedding vector(N)); HNSW index; RLS same as
   transcripts. Pick the embedding model first, justify it for Gujarati/Hindi/English
   text, and set N from its docs.
2. Chunk on speaker turns (never split a turn), about 300-500 tokens per chunk, overlap by
   one turn. Embed when a transcript becomes done.
3. A search RPC that filters by event_id BEFORE the vector search, returns the top 8
   chunks with call and family.
4. An "Ask about calls" screen: the answer must cite each claim as [family, date, quote]
   and say "Not found in any call" when retrieval returns nothing relevant. It never
   writes anything.
5. When a recording or transcript is erased (P8), its chunks are deleted too.

Files you may change: one migration, supabase/functions/ (embed + ask), one new screen,
src/lib/calls/, DECISIONS.md.

Done when: a question answerable from one test call returns that call with the right
quote, a question about another event's call returns nothing, typecheck + lint pass.
```

---

# PROMPT 8 — Retention and erasure

```
[PREAMBLE]

TASK: Make deletion real, both on a schedule and on request.

BUILD:
1. pg_cron job (migration, show and STOP) daily: delete audio objects whose
   audio_delete_after has passed, set recording_status 'deleted'. Transcripts and
   accepted call notes stay until the event's own retention date.
2. Admin action "Erase this person's call data" for one family or one phone number:
   deletes audio, transcript, transcript_chunks, pending review items and marks accepted
   call notes as erased. Writes one audit row (who, when, what was erased — not the
   content). Idempotent.
3. Opted-out calls: confirm nothing was ever uploaded; if anything was, erase it.
4. docs/CALL-PRIVACY.md: what is recorded, why, how long each thing is kept, who can see
   it, and how erasure works. This is the source for the privacy notice text.

Files you may change: one migration, supabase/functions/erase-call-data/, an admin screen,
docs/CALL-PRIVACY.md, DECISIONS.md.

Done when: erasing a test family leaves zero rows and zero storage objects for its calls
(show the queries), the audit row exists, running it twice does not error.
```

---

# PROMPT 9 — The 5-call test

```
[PREAMBLE]

TASK: Write the runbook and the checks for the 5-call test. Do not change src/.

WRITE docs/CALL-TEST.md:
1. Setup: which handset, H0 passed, the event, the 5 consenting people.
2. The 5 calls, chosen to stress different things:
     C1 English only, quiet room
     C2 Gujarati only
     C3 Hindi-English mix with a flight number and a date
     C4 Noisy background, speaker talks over the caller
     C5 Callee asks not to be recorded -> opt-out path
3. Per call, a row to fill in by hand: harvested (y/n, minutes after call) | matched to
   the right family (y/n) | transcript status | transcript accuracy 1-5 (listen to the
   audio while reading) | speakers labelled right (y/n) | each extracted field correct /
   wrong / missing | fields invented without evidence (count — must be 0) | time from hang
   up to review item | Sarvam cost for the call.
4. Pass bar: 5/5 harvested and matched, C5 never uploaded, 0 invented fields, average
   transcript accuracy >= 4 for C1-C3. Anything below the bar names the prompt to revisit.

Also add supabase/tests/call_pipeline.sql: after the test, verify every call row has a
consistent recording_status and every 'harvested' call has exactly one recording row.

Files you may change: docs/CALL-TEST.md (new), supabase/tests/call_pipeline.sql (new),
DECISIONS.md.

Done when: both files exist and `git status` shows nothing under src/ changed.
```

---

## Running order

| Prompt | What it buys | Needed for 5-call test |
|---|---|---|
| P0 | Stops you rebuilding what already exists | Yes |
| P1 | Event-fenced tables, private bucket, RLS tests | Yes |
| P2 | Spoken announcement, opt-out, matchable call rows | Yes |
| P3 | Recording gets from handset to storage, matched | Yes |
| P4 | Sarvam transcripts with speakers | Yes |
| P5 | Call notes a human approves | Yes |
| P6 | Excel | Yes |
| P9 | The test itself | Yes |
| P7 | Ask questions across calls (RAG) | After |
| P8 | Retention + erasure (required before real client calls) | After test, before launch |

**What to check yourself after each Qwen session:** RLS policies (P1), that the API key
never leaves Edge Functions (P4), that extraction never writes to guest records (P5), and
that erasure reaches every table (P8). These are where generated code can look right and
be wrong.
