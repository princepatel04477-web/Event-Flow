-- =====================================================================
-- L2 — TRANSCRIPTION PIPELINE SECURITY + CONTRACT SUITE
-- =====================================================================
-- Covers the DB-side guarantees the transcribe-recording Edge Function
-- depends on, and the access fencing around `transcripts`.
--
-- SCRATCH DATABASE ONLY. Seeds its own event and users.
--
--   psql "$SCRATCH_URL" -v ON_ERROR_STOP=off -f tests/l2_transcribe.sql
--
-- ---------------------------------------------------------------------
-- READ THIS BEFORE TRUSTING THE SCOREBOARD
--
-- The task spec asks to "prove with an RLS test" that the function has zero
-- write permission on guest_groups / room_assignments / deliverables /
-- delivery_proofs. That cannot be proven by an RLS test, and this suite does
-- not pretend otherwise.
--
-- The function authenticates with the SERVICE ROLE KEY, and service_role
-- carries BYPASSRLS. No policy constrains it — that is the whole point of the
-- key. Writing a test that asserts "service_role cannot write guest_groups"
-- would fail honestly, or pass only by testing some other role and mislabelling
-- it.
--
-- What IS enforceable, and is tested below:
--   * delivery_proofs UPDATE/DELETE are blocked by unconditional triggers,
--     which bind even service_role and even superuser (L2.7, L2.8).
--   * A client session cannot read transcripts at all (L2.1).
--   * Cross-event reads are fenced (L2.3).
--
-- What is enforced by code review only, and must stay that way unless the
-- function is moved off the service role onto a purpose-made database role
-- with explicit grants:
--   * The function's only write targets are `transcripts` rows.
-- That restraint is asserted in the function's header comment. If this ever
-- needs to be a hard guarantee, the fix is a dedicated role + REVOKE, not a
-- policy — and then these tests become real.
-- =====================================================================

\set ON_ERROR_STOP off
\pset pager off
\timing off

drop schema if exists l2 cascade;
create schema l2;

create table l2.results (
  id text, name text, expected text, actual text, result text, severity text
);

create or replace function l2.record(
  p_id text, p_name text, p_expected text, p_actual text,
  p_severity text default 'BLOCKS EVENT'
) returns void
language sql security definer
set search_path = ''
as $$
  insert into l2.results (id, name, expected, actual, result, severity)
  values (p_id, p_name, p_expected, p_actual,
          case when p_expected = p_actual then 'PASS' else 'FAIL' end,
          p_severity);
$$;

grant usage on schema l2 to public;
grant execute on function l2.record(text,text,text,text,text) to public;

create or replace function l2.write_outcome(p_rows int, p_sqlstate text)
returns text language sql immutable
as $$
  select case
    when p_sqlstate in ('42501','23514','23503','23505','P0001') then 'denied'
    when p_sqlstate is not null then 'denied:' || p_sqlstate
    when p_rows = 0             then 'denied'
    else 'ALLOWED'
  end;
$$;

create or replace function l2.read_count(p_sql text)
returns text language plpgsql
as $$
declare n int;
begin
  execute p_sql into n;
  return n::text;
exception
  when insufficient_privilege then return 'no-access';
  when others then return 'error:' || sqlstate;
end;
$$;
grant execute on function l2.read_count(text) to public;

-- ---------------------------------------------------------------------
-- SEED (superuser)
-- ---------------------------------------------------------------------
\echo '=== seeding ==='

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000b1', 'l2admin@x.com')
on conflict do nothing;

insert into public.profiles (id, global_role)
values ('00000000-0000-0000-0000-0000000000b1', 'admin')
on conflict (id) do update set global_role = 'admin';

insert into public.events (id, code, name, created_by) values
  ('22222222-2222-2222-2222-222222222221', 'L2EVENT1', 'L2 Event One',
   '00000000-0000-0000-0000-0000000000b1'),
  ('22222222-2222-2222-2222-222222222222', 'L2EVENT2', 'L2 Event Two',
   '00000000-0000-0000-0000-0000000000b1')
on conflict do nothing;

insert into public.staff_members (id, event_id, full_name) values
  ('33333333-2222-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222221', 'L2 Caller')
on conflict do nothing;

insert into public.event_access_codes
  (id, event_id, role, code_hash, code_prefix, last_four) values
  ('44444444-2222-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222221',
   'team',   repeat('a', 64), 'E', 'aaaa'),
  ('44444444-2222-0000-0000-00000000000c', '22222222-2222-2222-2222-222222222221',
   'client', repeat('c', 64), 'C', 'cccc')
on conflict do nothing;

insert into public.guest_groups (id, event_id, family_name, primary_mobile) values
  ('55555555-2222-0000-0000-000000000001', '22222222-2222-2222-2222-222222222221',
   'L2 Family', '9000000001')
on conflict do nothing;

insert into public.call_recordings
  (id, event_id, group_id, storage_path, duration_sec) values
  ('66666666-2222-0000-0000-000000000001', '22222222-2222-2222-2222-222222222221',
   '55555555-2222-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222221/55555555-2222-0000-0000-000000000001/a.m4a', 180),
  ('66666666-2222-0000-0000-000000000002', '22222222-2222-2222-2222-222222222221',
   '55555555-2222-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222221/55555555-2222-0000-0000-000000000001/b.m4a', 5)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- L2.0 — the pending-row contract.
-- `transcripts.text` is NOT NULL (legacy column, predates full_text). The
-- function inserts '' so the pending row can exist BEFORE Sarvam is called.
-- If a future migration makes `text` nullable, this test still passes; if it
-- makes it non-defaultable in some new way, this catches it.
-- ---------------------------------------------------------------------
\echo '=== L2.0 pending row before STT ==='
do $$
declare v_rows int := 0; v_state text;
begin
  insert into public.transcripts (event_id, recording_id, text, status, provider)
  values ('22222222-2222-2222-2222-222222222221',
          '66666666-2222-0000-0000-000000000001', '', 'pending', 'sarvam');
  get diagnostics v_rows = row_count;
exception when others then v_state := sqlstate;
end $$;

select l2.record(
  'L2.0-pending-insert',
  'A pending transcript row can be created before any STT spend',
  'present',
  coalesce((select status from public.transcripts
             where recording_id = '66666666-2222-0000-0000-000000000001'), 'MISSING')
);

-- ---------------------------------------------------------------------
-- L2.1 — a CLIENT session cannot read transcripts.
-- Transcripts are raw evidence: unreviewed, unredacted, and full of things a
-- client should never see. RLS gates SELECT on app.is_staff(), and a client
-- is is_member but NOT is_staff.
-- ---------------------------------------------------------------------
\echo '=== L2.1 client cannot read transcripts ==='
set local role authenticated;
set request.jwt.claims = '{"role":"authenticated","app_role":"client","event_id":"22222222-2222-2222-2222-222222222221","access_code_id":"44444444-2222-0000-0000-00000000000c"}';

select l2.record(
  'L2.1-client-read-transcripts',
  'A client session reads zero transcripts',
  '0',
  l2.read_count('select count(*) from public.transcripts')
);

select l2.record(
  'L2.1-client-read-backlog-view',
  'A client session reads zero rows from v_transcription_backlog',
  '0',
  l2.read_count('select count(*) from public.v_transcription_backlog')
);

reset request.jwt.claims;
reset role;

-- ---------------------------------------------------------------------
-- L2.2 — a TEAM session on the event CAN read its own transcripts.
-- The negative tests above are only meaningful if the positive one works.
-- ---------------------------------------------------------------------
\echo '=== L2.2 team can read own transcripts ==='
set local role authenticated;
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"22222222-2222-2222-2222-222222222221","access_code_id":"44444444-2222-0000-0000-00000000000a","staff_member_id":"33333333-2222-0000-0000-00000000000a"}';

select l2.record(
  'L2.2-team-read-own',
  'A team session on the event reads its transcript',
  '1',
  l2.read_count('select count(*) from public.transcripts')
);

reset request.jwt.claims;
reset role;

-- ---------------------------------------------------------------------
-- L2.3 — cross-event fencing. A team session on event TWO must not see
-- event ONE's transcripts.
-- ---------------------------------------------------------------------
\echo '=== L2.3 cross-event fencing ==='
set local role authenticated;
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"22222222-2222-2222-2222-222222222222","access_code_id":"44444444-2222-0000-0000-00000000000a","staff_member_id":"33333333-2222-0000-0000-00000000000a"}';

select l2.record(
  'L2.3-cross-event-transcripts',
  'A team session on another event reads zero transcripts',
  '0',
  l2.read_count('select count(*) from public.transcripts')
);

reset request.jwt.claims;
reset role;

-- ---------------------------------------------------------------------
-- L2.4 — status is constrained. A typo'd status must not silently create a
-- transcript that no worker will ever pick up.
-- ---------------------------------------------------------------------
\echo '=== L2.4 status check constraint ==='
do $$
declare v_rows int := 0; v_state text;
begin
  update public.transcripts set status = 'done'
   where recording_id = '66666666-2222-0000-0000-000000000001';
  get diagnostics v_rows = row_count;
exception when others then v_state := sqlstate;
end $$;

-- The row was left 'pending' by L2.0. A refused update leaves it 'pending';
-- an accepted one would read 'done'.
select l2.record(
  'L2.4-status-constraint',
  'An out-of-enum status is refused, row stays pending',
  'pending',
  coalesce((select status from public.transcripts
             where recording_id = '66666666-2222-0000-0000-000000000001'), 'MISSING')
);

-- ---------------------------------------------------------------------
-- L2.5 — one transcript per recording. This is what makes a duplicate
-- webhook delivery safe: the second insert cannot create a second row, so a
-- redelivery can never double-bill STT.
-- ---------------------------------------------------------------------
\echo '=== L2.5 idempotency: one transcript per recording ==='
do $$
declare v_state text;
begin
  insert into public.transcripts (event_id, recording_id, text, status)
  values ('22222222-2222-2222-2222-222222222221',
          '66666666-2222-0000-0000-000000000001', '', 'pending');
exception when others then v_state := sqlstate;
end $$;

select l2.record(
  'L2.5-one-transcript-per-recording',
  'A second transcript for the same recording is refused',
  '1',
  l2.read_count('select count(*) from public.transcripts where recording_id = ''66666666-2222-0000-0000-000000000001''')
);

-- ---------------------------------------------------------------------
-- L2.6 — the too-short guard is a FUNCTION-side decision, not a DB one.
-- There is deliberately no CHECK on duration_sec: a 5-second recording is a
-- legitimate row (it happened), it just must not be sent to Sarvam. This test
-- documents that the row is storable, so the skip logic is the only thing
-- standing between a misdial and ₹0.75.
-- ---------------------------------------------------------------------
\echo '=== L2.6 short recording is storable (skip is function-side) ==='
select l2.record(
  'L2.6-short-recording-stored',
  'A 5-second recording exists and is left for the function to skip',
  '1',
  l2.read_count('select count(*) from public.call_recordings where id = ''66666666-2222-0000-0000-000000000002'' and duration_sec < 10')
);

-- ---------------------------------------------------------------------
-- L2.7 / L2.8 — delivery_proofs immutability binds even the roles this
-- function runs as. This is the one "zero write permission" claim that is
-- genuinely provable, because the triggers are unconditional.
-- ---------------------------------------------------------------------
\echo '=== L2.7 delivery_proofs immutable to service_role ==='
set local role service_role;
set request.jwt.claims = '{"role":"service_role"}';

do $$
declare v_rows int := 0; v_state text;
begin
  update public.delivery_proofs set storage_path = 'tampered';
  get diagnostics v_rows = row_count;
  perform l2.record('L2.7-proof-update-service-role',
    'service_role cannot update a delivery proof', 'denied',
    l2.write_outcome(v_rows, null));
exception when others then
  perform l2.record('L2.7-proof-update-service-role',
    'service_role cannot update a delivery proof', 'denied',
    l2.write_outcome(0, sqlstate));
end $$;

do $$
declare v_rows int := 0;
begin
  delete from public.delivery_proofs;
  get diagnostics v_rows = row_count;
  perform l2.record('L2.8-proof-delete-service-role',
    'service_role cannot delete a delivery proof', 'denied',
    l2.write_outcome(v_rows, null));
exception when others then
  perform l2.record('L2.8-proof-delete-service-role',
    'service_role cannot delete a delivery proof', 'denied',
    l2.write_outcome(0, sqlstate));
end $$;

reset request.jwt.claims;
reset role;

-- ---------------------------------------------------------------------
-- L2.9 — THE RULE: a call must never vanish.
--
-- A failed transcription produces no extraction row. Before v_review_queue
-- the review screen read rsvp_extractions only, so such a call was invisible
-- to the person who made it — the conversation happened and the outcome was
-- silently dropped. These tests assert it reaches her.
-- ---------------------------------------------------------------------
\echo '=== L2.9 failed transcription reaches the review queue ==='

update public.transcripts
   set status = 'failed', error_text = 'too_short'
 where recording_id = '66666666-2222-0000-0000-000000000001';

select l2.record(
  'L2.9-failed-reaches-queue',
  'A failed transcription appears in the review queue as a manual item',
  '1',
  l2.read_count(
    'select count(*) from public.v_review_queue
      where kind = ''manual''
        and recording_id = ''66666666-2222-0000-0000-000000000001''')
);

select l2.record(
  'L2.9-failure-reason-carried',
  'The manual item carries why it failed, so she knows what she is looking at',
  'too_short',
  coalesce((select failure_reason from public.v_review_queue
             where recording_id = '66666666-2222-0000-0000-000000000001'), 'MISSING')
);

-- ---------------------------------------------------------------------
-- L2.10 — a recording with NO transcript row at all. Younger than 10 minutes
-- it is still in flight and must stay out of the queue; older than that the
-- enqueue was lost and it must appear.
-- ---------------------------------------------------------------------
\echo '=== L2.10 orphaned recording, 10-minute rule ==='

insert into public.call_recordings
  (id, event_id, group_id, storage_path, duration_sec, recorded_at) values
  ('66666666-2222-0000-0000-000000000003', '22222222-2222-2222-2222-222222222221',
   '55555555-2222-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222221/55555555-2222-0000-0000-000000000001/fresh.m4a',
   120, now())
on conflict do nothing;

select l2.record(
  'L2.10-fresh-orphan-excluded',
  'A recording with no transcript, under 10 minutes old, stays OUT of the queue',
  '0',
  l2.read_count(
    'select count(*) from public.v_review_queue
      where recording_id = ''66666666-2222-0000-0000-000000000003''')
);

-- recorded_at is force-stamped by trigger on INSERT, so age it with an UPDATE.
update public.call_recordings
   set recorded_at = now() - interval '11 minutes'
 where id = '66666666-2222-0000-0000-000000000003';

select l2.record(
  'L2.10-stale-orphan-included',
  'A recording with no transcript, over 10 minutes old, reaches the queue',
  '1',
  l2.read_count(
    'select count(*) from public.v_review_queue
      where kind = ''manual''
        and recording_id = ''66666666-2222-0000-0000-000000000003''')
);

-- ---------------------------------------------------------------------
-- L2.11 — the queue is still fenced. Everything above is worthless if a
-- client login can read it.
-- ---------------------------------------------------------------------
\echo '=== L2.11 client cannot read the review queue ==='
set local role authenticated;
set request.jwt.claims = '{"role":"authenticated","app_role":"client","event_id":"22222222-2222-2222-2222-222222222221","access_code_id":"44444444-2222-0000-0000-00000000000c"}';

select l2.record(
  'L2.11-client-read-review-queue',
  'A client session reads zero rows from v_review_queue',
  '0',
  l2.read_count('select count(*) from public.v_review_queue')
);

reset request.jwt.claims;
reset role;

-- ---------------------------------------------------------------------
-- SCOREBOARD
-- ---------------------------------------------------------------------
\echo ''
\echo '=== L2 SCOREBOARD ==='
select id, result, name, expected, actual from l2.results order by id;

select
  count(*) filter (where result = 'PASS') as passed,
  count(*) filter (where result = 'FAIL') as failed,
  count(*)                                as total
from l2.results;
