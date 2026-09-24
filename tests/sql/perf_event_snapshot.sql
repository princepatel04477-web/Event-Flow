-- =====================================================================
-- PERF-DATA — event_snapshot / event_changes_since
-- =====================================================================
-- SCRATCH DATABASE ONLY. This file seeds an event, writes into
-- delivery_proofs (permanently immutable) and mutates shared rows, so it
-- must never run against a database holding real guest data.
--
--   docker exec -i supabase_db_<project> psql -U postgres -d <scratch> \
--     -f - < tests/sql/perf_event_snapshot.sql
--
-- WHAT IT PROVES, and why each one is here rather than assumed:
--
--   P1  a team session gets the whole event, with the row counts and the
--       pre-reduced callStats the phone's store depends on
--   P2  a team session scoped to event A cannot snapshot event B
--   P3  a CLIENT session gets `client` and NOT the staff arrays — the
--       single most important assertion in this file, because
--       getEventByCode() deliberately makes "not yours" and "does not
--       exist" indistinguishable and one wrong branch here would hand a
--       client the whole calling list
--   P4  no claims at all -> 42501, not an empty payload
--   P5  changes_since(watermark) is empty (the watermark contract:
--       nothing committed before it is re-delivered)
--   P6  a group UPDATE is caught by its `updated_at`
--   P7  callStats is REPLACED whole (n recomputed), not incremented
--   P8  delivery_proofs, which has no updated_at, is caught by
--       `recorded_at`
--   P9  a soft release is an UPDATE, so it IS visible to changes_since —
--       and drops out of a fresh snapshot's `assignments`
--   P10 `event_id` / `source_row_hash` are stripped from the rows
--   P11 anon holds no EXECUTE on the app-facing wrapper
--
-- Denial semantics match tests/l1_adversarial.sql: a refusal may be an
-- exception or an empty result, and this suite asserts which.
-- =====================================================================

\set ON_ERROR_STOP off
\pset pager off
\timing off

-- ---------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------
drop schema if exists perf1 cascade;
create schema perf1;

create table perf1.results (
  seq      serial primary key,
  id       text not null,
  name     text not null,
  expected text not null,
  actual   text not null,
  result   text not null
);

create or replace function perf1.record(
  p_id text, p_name text, p_expected text, p_actual text
) returns void
language sql security definer
set search_path = ''
as $$
  insert into perf1.results (id, name, expected, actual, result)
  values (p_id, p_name, p_expected, p_actual,
          case when p_expected = p_actual then 'PASS' else 'FAIL' end);
$$;

grant usage on schema perf1 to public;
grant execute on function perf1.record(text,text,text,text) to public;

-- ---------------------------------------------------------------------
-- SETUP (superuser)
-- ---------------------------------------------------------------------
\echo '=== seeding two events ==='

insert into public.events (id, name, code, starts_on, ends_on, venue_city) values
  ('77777777-7777-7777-7777-777777777777', 'Perf Event A', 'PERFA26',
   '2026-12-20', '2026-12-24', 'Ahmedabad'),
  ('88888888-8888-8888-8888-888888888888', 'Perf Event B', 'PERFB26',
   '2027-01-10', '2027-01-12', 'Surat')
on conflict (id) do nothing;

insert into public.event_access_codes (id, event_id, role, code_hash, code_prefix, last_four) values
  ('44444444-0000-0000-0000-0000000000f1', '77777777-7777-7777-7777-777777777777',
   'team',   'hash-team-perfa',   'E', 'f001'),
  ('44444444-0000-0000-0000-0000000000f2', '77777777-7777-7777-7777-777777777777',
   'client', 'hash-client-perfa', 'C', 'f002')
on conflict (id) do nothing;

insert into public.staff_members (id, event_id, full_name) values
  ('33333333-0000-0000-0000-0000000000f1', '77777777-7777-7777-7777-777777777777', 'Ravi Patel'),
  ('33333333-0000-0000-0000-0000000000f2', '77777777-7777-7777-7777-777777777777', 'Meera Shah')
on conflict (id) do nothing;

-- Event A: two families, three guests.
insert into public.guest_groups
  (id, event_id, head_name, primary_mobile, rsvp_status, expected_pax, confirmed_pax,
   group_type, side, priority, source_row_hash)
values
  ('aa000000-0000-0000-0000-0000000000a1', '77777777-7777-7777-7777-777777777777',
   'Sharma', '9825011111', 'confirmed', 6, 6, 'family', 'bride', 5, 'deadbeef01'),
  ('aa000000-0000-0000-0000-0000000000a2', '77777777-7777-7777-7777-777777777777',
   'Desai',  '9825022222', 'not_started', 3, null, 'family', 'groom', 0, 'deadbeef02')
on conflict (id) do nothing;

insert into public.guests (id, event_id, group_id, full_name, mobile, is_head, age_band) values
  ('bb000000-0000-0000-0000-0000000000b1', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', 'Ramesh Sharma', '9825011111', true,  'adult'),
  ('bb000000-0000-0000-0000-0000000000b2', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', 'Sita Sharma',   null,         false, 'adult'),
  ('bb000000-0000-0000-0000-0000000000b3', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a2', 'Nilesh Desai',  '9825022222', true,  'adult')
on conflict (id) do nothing;

insert into public.travel_legs
  (id, event_id, group_id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg)
values
  ('cc000000-0000-0000-0000-0000000000c1', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', 'arrival', 'air', '2026-12-20', '10:30', '6E 5074', 'AMD T2', 6)
on conflict (id) do nothing;

insert into public.hotels (id, event_id, name) values
  ('dd000000-0000-0000-0000-0000000000d1', '77777777-7777-7777-7777-777777777777', 'Grand Bhagwati')
on conflict (id) do nothing;

insert into public.rooms (id, event_id, hotel_id, room_number, capacity, max_capacity, floor)
values
  ('ee000000-0000-0000-0000-0000000000e1', '77777777-7777-7777-7777-777777777777',
   'dd000000-0000-0000-0000-0000000000d1', 'A101', 2, 3, '1')
on conflict (id) do nothing;

insert into public.room_assignments
  (id, event_id, room_id, guest_id, group_id, check_in_date, check_out_date)
values
  ('ff000000-0000-0000-0000-0000000000f1', '77777777-7777-7777-7777-777777777777',
   'ee000000-0000-0000-0000-0000000000e1', 'bb000000-0000-0000-0000-0000000000b1',
   'aa000000-0000-0000-0000-0000000000a1', '2026-12-20', '2026-12-24')
on conflict (id) do nothing;

insert into public.deliverables (id, event_id, group_id, kind, item_name, quantity, status)
values
  ('12120000-0000-0000-0000-000000000012', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', 'hamper', 'Diwali hamper', 1, 'delivered')
on conflict (id) do nothing;

insert into public.delivery_proofs
  (id, event_id, deliverable_id, storage_bucket, storage_path, captured_by_staff, received_by_name)
values
  ('13130000-0000-0000-0000-000000000013', '77777777-7777-7777-7777-777777777777',
   '12120000-0000-0000-0000-000000000012', 'delivery-proofs',
   '77777777-7777-7777-7777-777777777777/12120000-0000-0000-0000-000000000012/x.jpg',
   '33333333-0000-0000-0000-0000000000f1', 'Ramesh')
on conflict (id) do nothing;

insert into public.vehicles (id, event_id, label, capacity, status) values
  ('14140000-0000-0000-0000-000000000014', '77777777-7777-7777-7777-777777777777',
   'Innova #2', 6, 'available')
on conflict (id) do nothing;

insert into public.trips (id, event_id, vehicle_id, direction, seats_capacity, status) values
  ('15150000-0000-0000-0000-000000000015', '77777777-7777-7777-7777-777777777777',
   '14140000-0000-0000-0000-000000000014', 'arrival', 6, 'planned')
on conflict (id) do nothing;

insert into public.trip_passengers (id, event_id, trip_id, group_id, travel_leg_id, pax) values
  ('16160000-0000-0000-0000-000000000016', '77777777-7777-7777-7777-777777777777',
   '15150000-0000-0000-0000-000000000015', 'aa000000-0000-0000-0000-0000000000a1',
   'cc000000-0000-0000-0000-0000000000c1', 6)
on conflict (id) do nothing;

-- Two attempts on the Sharma family: callStats.n must be 2, not 2 rows.
insert into public.call_attempts
  (id, event_id, group_id, caller_id, caller_id_staff, dialed_number, started_at, outcome)
values
  ('17170000-0000-0000-0000-000000000017', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', null, '33333333-0000-0000-0000-0000000000f1',
   '9825011111', now() - interval '2 hours', 'no_answer'),
  ('17170000-0000-0000-0000-000000000018', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', null, '33333333-0000-0000-0000-0000000000f1',
   '9825011111', now() - interval '1 hour', 'connected')
on conflict (id) do nothing;

-- Event B: one family, one guest. Nothing of B may appear in A's snapshot.
insert into public.guest_groups (id, event_id, head_name, rsvp_status, expected_pax)
values
  ('aa000000-0000-0000-0000-0000000b0001', '88888888-8888-8888-8888-888888888888',
   'EventB Family', 'not_started', 2)
on conflict (id) do nothing;

insert into public.guests (id, event_id, group_id, full_name, is_head)
values
  ('bb000000-0000-0000-0000-0000000b0001', '88888888-8888-8888-8888-888888888888',
   'aa000000-0000-0000-0000-0000000b0001', 'B Head', true)
on conflict (id) do nothing;

-- =====================================================================
-- P1 — team session, whole event
-- =====================================================================
\echo '=== P1 team snapshot ==='

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"77777777-7777-7777-7777-777777777777","access_code_id":"44444444-0000-0000-0000-0000000000f1","staff_member_id":"33333333-0000-0000-0000-0000000000f1"}';
set role authenticated;

select perf1.record('P1.1', 'role is team', 'team',
  public.event_snapshot('77777777-7777-7777-7777-777777777777') ->> 'role');

select perf1.record('P1.2', 'event header is the requested event',
  '77777777-7777-7777-7777-777777777777|PERFA26',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'event' ->> 'id')
  || '|' ||
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'event' ->> 'code'));

select perf1.record('P1.3', 'groups: 2 (event A only, event B excluded)', '2',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'groups')::text);

select perf1.record('P1.4', 'guests: 3 (event A only)', '3',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'guests')::text);

select perf1.record('P1.5', 'client view rows: 3', '3',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'client')::text);

select perf1.record('P1.6', 'assignments: 1 active', '1',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'assignments')::text);

select perf1.record('P1.7', 'callStats is ONE entry for a group called twice', '1|2',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'callStats')::text
  || '|' ||
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'callStats' -> 0 ->> 'n'));

select perf1.record('P1.8', 'callStats.lastOutcome is the NEWEST attempt', 'connected',
  public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'callStats' -> 0 ->> 'lastOutcome');

select perf1.record('P1.9', 'watermark present and not null', 't',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') ->> 'watermark' is not null)::text);

select perf1.record('P1.10', 'legs: 1', '1',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'legs')::text);

select perf1.record('P1.11', 'trips and passengers shipped', '1|1',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'trips')::text
  || '|' ||
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'tripPassengers')::text);

select perf1.record('P1.12', 'staff names shipped', '2',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'staff')::text);

select perf1.record('P1.13', 'proofs shipped', '1',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'proofs')::text);

-- P10 — compaction. There is no `event_id` on any shipped row, and no
-- source_row_hash on a group. Asserted structurally rather than by string
-- search, so a future column named e.g. `event_id_copy` cannot fool it.
select perf1.record('P10.1', 'no event_id key on a group row', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'groups' -> 0 ? 'event_id')::text);

select perf1.record('P10.2', 'no source_row_hash on a group row', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'groups' -> 0 ? 'source_row_hash')::text);

select perf1.record('P10.3', 'no event_id key on a guest row', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'guests' -> 0 ? 'event_id')::text);

select perf1.record('P10.4', 'head_name survives compaction', 'Sharma',
  public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'groups' -> 0 ->> 'head_name');

reset role;

-- =====================================================================
-- P5/P6/P7/P8/P9 — changes_since
-- =====================================================================
\echo '=== changes_since ==='

-- The watermark is taken as the superuser (any session sees the same
-- clock), then driven forward with real writes.
create temp table perf1_wm as
  select public.event_snapshot('77777777-7777-7777-7777-777777777777') ->> 'watermark' as wm;

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"77777777-7777-7777-7777-777777777777","access_code_id":"44444444-0000-0000-0000-0000000000f1","staff_member_id":"33333333-0000-0000-0000-0000000000f1"}';
set role authenticated;

-- P5 — nothing has changed since the snapshot.
select perf1.record('P5.1', 'changes_since(watermark): groups empty', '0',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'groups')::text);

select perf1.record('P5.2', 'changes_since(watermark): guests empty', '0',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'guests')::text);

select perf1.record('P5.3', 'changes_since reports deletesSeen = false', 'false',
  public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) ->> 'deletesSeen');

reset role;

-- Real changes, as superuser (the app would do these through its RPCs).
update public.guest_groups set head_name = 'Sharma (renamed)'
 where id = 'aa000000-0000-0000-0000-0000000000a1';

insert into public.call_attempts
  (id, event_id, group_id, caller_id, caller_id_staff, dialed_number, started_at, outcome)
values
  ('17170000-0000-0000-0000-000000000019', '77777777-7777-7777-7777-777777777777',
   'aa000000-0000-0000-0000-0000000000a1', null, '33333333-0000-0000-0000-0000000000f2',
   '9825011111', now(), 'callback');

insert into public.delivery_proofs
  (id, event_id, deliverable_id, storage_bucket, storage_path, captured_by_staff)
values
  ('13130000-0000-0000-0000-000000000014', '77777777-7777-7777-7777-777777777777',
   '12120000-0000-0000-0000-000000000012', 'delivery-proofs',
   '77777777-7777-7777-7777-777777777777/12120000-0000-0000-0000-000000000012/y.jpg',
   '33333333-0000-0000-0000-0000000000f1');

update public.room_assignments
   set released_at = now(), release_reason = 'perf test soft release'
 where id = 'ff000000-0000-0000-0000-0000000000f1';

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"77777777-7777-7777-7777-777777777777","access_code_id":"44444444-0000-0000-0000-0000000000f1","staff_member_id":"33333333-0000-0000-0000-0000000000f1"}';
set role authenticated;

-- P6 — the UPDATE is caught by updated_at, and only that one group.
select perf1.record('P6.1', 'changes_since: exactly 1 changed group', '1',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'groups')::text);

select perf1.record('P6.2', 'changes_since: the new head_name', 'Sharma (renamed)',
  public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'groups' -> 0 ->> 'head_name');

-- P7 — callStats is the whole recomputed aggregate: n goes 2 -> 3 and the
-- newest outcome is the callback, in ONE entry.
select perf1.record('P7.1', 'changes_since: callStats replaced whole (n=3)', '1|3',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'callStats')::text
  || '|' ||
  (public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'callStats' -> 0 ->> 'n'));

select perf1.record('P7.2', 'changes_since: newest call outcome is callback', 'callback',
  public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'callStats' -> 0 ->> 'lastOutcome');

-- P8 — the proof has no updated_at; recorded_at is its clock.
select perf1.record('P8.1', 'changes_since: the new proof is delivered', '1',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'proofs')::text);

select perf1.record('P8.2', 'changes_since: the new proof is the right one', '13130000-0000-0000-0000-000000000014',
  public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'proofs' -> 0 ->> 'id');

-- P9 — the soft release is an UPDATE, so it arrives with released_at set.
select perf1.record('P9.1', 'changes_since: the released assignment arrives', '1',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'assignments')::text);

select perf1.record('P9.2', 'changes_since: released_at is set on it', 't',
  (public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm))
    -> 'assignments' -> 0 ->> 'released_at' is not null)::text);

-- A FULL snapshot, by contrast, must not ship the released row.
select perf1.record('P9.3', 'full snapshot excludes the released assignment', '0',
  jsonb_array_length(public.event_snapshot(
    '77777777-7777-7777-7777-777777777777') -> 'assignments')::text);

reset role;

-- P9.4 — AN UN-RELEASE IS A UPDATE TOO, and the client has to see it or the
-- put-back never appears. This is the mirror of P9.1/P9.2 and it is the case a
-- `released_at is null` filter on the DELTA would have broken: the client
-- removes a released assignment from its active map and has no other signal,
-- so a row that comes back must travel as a normal changed row.
update public.room_assignments
   set released_at = null, release_reason = null
 where id = 'ff000000-0000-0000-0000-0000000000f1';

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"77777777-7777-7777-7777-777777777777","access_code_id":"44444444-0000-0000-0000-0000000000f1","staff_member_id":"33333333-0000-0000-0000-0000000000f1"}';
set role authenticated;

select perf1.record('P9.4', 'a re-activated assignment arrives with released_at null', '1|t',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm)) -> 'assignments')::text
  || '|' ||
  (public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', (select wm from perf1_wm))
    -> 'assignments' -> 0 ->> 'released_at' is null)::text);

select perf1.record('P9.5', 'and it is back in a fresh full snapshot', '1',
  jsonb_array_length(public.event_snapshot(
    '77777777-7777-7777-7777-777777777777') -> 'assignments')::text);

reset role;

-- P12 — THE COMPACT-KEY CONTRACT THE CLIENT PARSER DEPENDS ON.
--
-- `src/lib/store/snapshot.ts` refuses a payload whose `v` it does not know and
-- requires the envelope keys below; `parseSnapshot` is unit-tested against a
-- fixture, but nothing else asserts that the FUNCTION agrees with the fixture.
-- A rename here without a matching change there is a phone that falls back to
-- the slow path silently, so the keys are pinned.
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"77777777-7777-7777-7777-777777777777","access_code_id":"44444444-0000-0000-0000-0000000000f1","staff_member_id":"33333333-0000-0000-0000-0000000000f1"}';
set role authenticated;

select perf1.record('P12.1', 'payload version is 1', '1',
  public.event_snapshot('77777777-7777-7777-7777-777777777777') ->> 'v');

select perf1.record('P12.2', 'envelope keys are exactly the ones the client reads',
  'assignments,at,callStats,client,deliverables,drivers,event,groups,guests,hotels,legs,odometer,proofs,role,rooms,staff,tripPassengers,trips,vehicleAssignments,vehicleTypes,vehicles,watermark',
  (select string_agg(k, ',' order by k)
     from jsonb_object_keys(public.event_snapshot(
       '77777777-7777-7777-7777-777777777777')) as k));

select perf1.record('P12.3', 'callStats entry keys are the compact four',
  'groupId,lastAt,lastOutcome,n,nextCallbackAt',
  (select string_agg(k, ',' order by k)
     from jsonb_object_keys(public.event_snapshot(
       '77777777-7777-7777-7777-777777777777') -> 'callStats' -> 0) as k));

reset role;

-- P2 — same session, the OTHER event. Not one row is visible.
do $$
declare v_state text;
begin
  begin
    perform public.event_snapshot('88888888-8888-8888-8888-888888888888');
    v_state := 'ALLOWED';
  exception when others then
    v_state := sqlstate;
  end;
  perform perf1.record('P2.1', 'team session cannot snapshot another event', '42501', v_state);
end $$;

do $$
declare v_state text;
begin
  begin
    perform public.event_changes_since('88888888-8888-8888-8888-888888888888', now());
    v_state := 'ALLOWED';
  exception when others then
    v_state := sqlstate;
  end;
  perform perf1.record('P2.2', 'team session cannot catch up another event', '42501', v_state);
end $$;

reset role;

-- =====================================================================
-- P3 — the client boundary
-- =====================================================================
\echo '=== P3 client session ==='

set request.jwt.claims = '{"role":"authenticated","app_role":"client","event_id":"77777777-7777-7777-7777-777777777777","access_code_id":"44444444-0000-0000-0000-0000000000f2"}';
set role authenticated;

select perf1.record('P3.1', 'client role is reported as client', 'client',
  public.event_snapshot('77777777-7777-7777-7777-777777777777') ->> 'role');

select perf1.record('P3.2', 'client gets client_guest_profiles rows', '3',
  jsonb_array_length(public.event_snapshot('77777777-7777-7777-7777-777777777777') -> 'client')::text);

-- The three that matter: no staff key exists in the payload at all. A
-- `?` test, not a length test, so an EMPTY array cannot pass for a
-- MISSING one.
select perf1.record('P3.3', 'client payload has NO groups key', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') ? 'groups')::text);

select perf1.record('P3.4', 'client payload has NO callStats key', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') ? 'callStats')::text);

select perf1.record('P3.5', 'client payload has NO assignments key', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777') ? 'assignments')::text);

select perf1.record('P3.6', 'client payload carries no primary_mobile', 'f',
  (public.event_snapshot('77777777-7777-7777-7777-777777777777')::text like '%9825011111%')::text);

-- The client's catch-up has no updated_at to work from, so it is the
-- whole (small) client array, and still nothing else.
select perf1.record('P3.7', 'client catch-up returns client rows', '3',
  jsonb_array_length(public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', now() - interval '1 day') -> 'client')::text);

select perf1.record('P3.8', 'client catch-up has NO groups key', 'f',
  (public.event_changes_since(
    '77777777-7777-7777-7777-777777777777', now() - interval '1 day') ? 'groups')::text);

reset role;

-- =====================================================================
-- P4/P11 — no session, and the grant model
-- =====================================================================
\echo '=== P4/P11 anonymous ==='

set request.jwt.claims = '{"role":"anon"}';
set role anon;

-- P11: anon must not even hold EXECUTE. Either outcome is a refusal; the
-- assertion is that it is not data.
do $$
declare v_state text;
begin
  begin
    perform public.event_snapshot('77777777-7777-7777-7777-777777777777');
    v_state := 'ALLOWED';
  exception when others then
    v_state := 'refused:' || sqlstate;
  end;
  perform perf1.record('P11.1', 'anon cannot call the snapshot wrapper', 'refused:42501', v_state);
end $$;

do $$
declare v_state text;
begin
  begin
    perform public.event_changes_since('77777777-7777-7777-7777-777777777777', now());
    v_state := 'ALLOWED';
  exception when others then
    v_state := 'refused:' || sqlstate;
  end;
  perform perf1.record('P11.2', 'anon cannot call the catch-up wrapper', 'refused:42501', v_state);
end $$;

reset role;

-- P4: an authenticated session with NO claims at all — a half-restored
-- session, which is a real state on a phone whose storage was cleared.
set request.jwt.claims = '{"role":"authenticated"}';
set role authenticated;

do $$
declare v_state text;
begin
  begin
    perform public.event_snapshot('77777777-7777-7777-7777-777777777777');
    v_state := 'ALLOWED';
  exception when others then
    v_state := sqlstate;
  end;
  perform perf1.record('P4.1', 'a claimless session is refused', '42501', v_state);
end $$;

reset role;

-- =====================================================================
-- SUMMARY
-- =====================================================================
\echo ''
\echo '=== RESULTS ==='
select id, name, expected, actual, result from perf1.results order by seq;

\echo ''
select result, count(*) from perf1.results group by result order by result;

\echo ''
select case when count(*) filter (where result = 'FAIL') = 0
            then 'PERF-DATA: ALL PASS'
            else 'PERF-DATA: FAILURES — see above'
       end as verdict
  from perf1.results;
