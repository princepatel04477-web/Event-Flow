\set ON_ERROR_STOP on
\pset pager off
begin;

-- ============ SETUP (as superuser) ============
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@x.com'),
  ('00000000-0000-0000-0000-0000000000b1', 'team1@x.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'client1@x.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'team2@x.com');

update public.profiles set global_role = 'admin'
 where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.events (id, name, code) values
  ('11111111-1111-1111-1111-111111111111', 'Sharma Wedding', 'SHARMA26'),
  ('22222222-2222-2222-2222-222222222222', 'Patel Wedding',  'PATEL26');

insert into public.event_members (event_id, user_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000b1', 'event_team'),
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-0000000000c1', 'client'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-0000000000b2', 'event_team');

insert into public.guest_groups (id, event_id, head_name, primary_mobile, expected_pax, needs_return_gift) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Ashwin Bhai', '9876543210', 6, true),
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'Arjun Bhai',  '9876500000', 2, false),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Other Event Head', '9000000000', 4, false);

insert into public.guests (id, event_id, group_id, full_name, is_head) values
  ('a1a1a1a1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Ashwin Bhai', true),
  ('b1b1b1b1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'Other Event Head', true);

insert into public.hotels (id, event_id, name) values
  ('11111111-aaaa-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Hyatt');
insert into public.rooms (id, event_id, hotel_id, room_number, capacity) values
  ('11111111-bbbb-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', '11111111-aaaa-0000-0000-000000000001', '205', 2);

insert into public.deliverables (id, event_id, kind, group_id, room_id) values
  ('11111111-cccc-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'hamper',
   'aaaaaaaa-0000-0000-0000-000000000001', '11111111-bbbb-0000-0000-000000000001');

\echo '=================================================================='
\echo 'TEST 1  event_team of Event 1 sees ONLY Event 1'
\echo '=================================================================='
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
select count(*) as groups_visible_to_team1 from public.guest_groups;
select count(*) as events_visible_to_team1 from public.events;

\echo '--- team1 tries to insert into Event 2 (must FAIL) ---'
savepoint s1;
do $$
begin
  insert into public.travel_legs (event_id, group_id, direction, mode)
  values ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'arrival', 'air');
  raise exception 'FAILED: cross-event insert was allowed';
exception when insufficient_privilege then
  raise notice 'PASS: cross-event insert blocked by RLS';
end $$;
rollback to s1;

\echo '--- team1 tries to DELETE a group (must FAIL: delete is admin only) ---'
with d as (
  delete from public.guest_groups
   where id = 'aaaaaaaa-0000-0000-0000-000000000002' returning 1
)
select count(*) as rows_deleted_by_team1 from d;

\echo '=================================================================='
\echo 'TEST 2  client sees NOTHING in base tables, only the profile view'
\echo '=================================================================='
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';
select count(*) as base_guest_groups_visible_to_client from public.guest_groups;
select count(*) as base_call_attempts_visible_to_client from public.call_attempts;
select count(*) as profiles_visible_to_client from public.client_guest_profiles;
select guest_name, family_head, pax, room_number, hamper_delivered
  from public.client_guest_profiles;

\echo '=================================================================='
\echo 'TEST 3  hamper proof: server clock wins, insert-only enforced'
\echo '=================================================================='
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';

insert into public.delivery_proofs
  (id, event_id, deliverable_id, storage_path, device_captured_at, recorded_at)
values
  ('11111111-dddd-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '11111111-cccc-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111/hamper1.jpg',
   '2020-01-01 00:00:00+00',    -- phone clock lying
   '2020-01-01 00:00:00+00');   -- client trying to force a fake server time

select
  device_captured_at              as untrusted_phone_clock,
  recorded_at > now() - interval '1 minute' as server_clock_won
from public.delivery_proofs;

select status as deliverable_status_after_photo
  from public.deliverables where id = '11111111-cccc-0000-0000-000000000001';

\echo '--- update a proof (must FAIL) ---'
savepoint s2;
do $$
begin
  update public.delivery_proofs set notes = 'tampered'
   where id = '11111111-dddd-0000-0000-000000000001';
  raise exception 'FAILED: proof was updatable';
exception when insufficient_privilege then
  raise notice 'PASS: proof update blocked';
end $$;
rollback to s2;

\echo '--- delete a proof (must FAIL) ---'
savepoint s3;
do $$
begin
  delete from public.delivery_proofs where id = '11111111-dddd-0000-0000-000000000001';
  raise exception 'FAILED: proof was deletable';
exception when insufficient_privilege then
  raise notice 'PASS: proof delete blocked';
end $$;
rollback to s3;

\echo '=================================================================='
\echo 'TEST 4  room capacity guard + manual override'
\echo '=================================================================='
insert into public.guests (id, event_id, group_id, full_name) values
  ('a1a1a1a1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member Two'),
  ('a1a1a1a1-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member Three');

insert into public.room_assignments (event_id, room_id, guest_id, group_id) values
  ('11111111-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('11111111-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000001', 'a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001');

savepoint s4;
do $$
begin
  insert into public.room_assignments (event_id, room_id, guest_id, group_id)
  values ('11111111-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000001',
          'a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001');
  raise exception 'FAILED: room overfilled silently';
exception when check_violation then
  raise notice 'PASS: capacity guard stopped the 3rd guest in a 2-bed room';
end $$;
rollback to s4;

insert into public.room_assignments (event_id, room_id, guest_id, group_id, is_override, override_reason)
values ('11111111-1111-1111-1111-111111111111', '11111111-bbbb-0000-0000-000000000001',
        'a1a1a1a1-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
        true, 'Family insisted on staying together');
\echo 'PASS: manual override accepted with a reason'

\echo '=================================================================='
\echo 'TEST 5  call attempts: server clock, freeze after finalize, no delete'
\echo '=================================================================='
insert into public.call_attempts (id, event_id, group_id, dialed_number, started_at)
values ('11111111-eeee-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', '9876543210', '2019-01-01 00:00:00+00');

select started_at > now() - interval '1 minute' as server_clock_won,
       device_started_at as phone_claimed
  from public.call_attempts;

update public.call_attempts
   set ended_at = now(), duration_sec = 95, outcome = 'connected'
 where id = '11111111-eeee-0000-0000-000000000001';
\echo 'PASS: first completion accepted'

savepoint s5;
do $$
begin
  update public.call_attempts set notes = 'rewriting history'
   where id = '11111111-eeee-0000-0000-000000000001';
  raise exception 'FAILED: finalized call was editable';
exception when insufficient_privilege then
  raise notice 'PASS: finalized call attempt is frozen';
end $$;
rollback to s5;

\echo '=================================================================='
\echo 'TEST 6  caller locking'
\echo '=================================================================='
select head_name from public.claim_group('aaaaaaaa-0000-0000-0000-000000000001', 15);

set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';  -- a second caller (admin)
savepoint s6;
do $$
begin
  perform public.claim_group('aaaaaaaa-0000-0000-0000-000000000001', 15);
  raise exception 'FAILED: two callers grabbed the same family';
exception when lock_not_available then
  raise notice 'PASS: second caller was refused the locked group';
end $$;
rollback to s6;

\echo '=================================================================='
\echo 'TEST 7  reviewed extraction commits atomically'
\echo '=================================================================='
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000b1';
insert into public.rsvp_extractions (id, event_id, group_id, parsed, confidence)
values ('11111111-ffff-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001',
        '{"rsvp_status":"confirmed"}'::jsonb, '{}'::jsonb);

select head_name, rsvp_status, confirmed_pax from public.apply_rsvp_extraction(
  '11111111-ffff-0000-0000-000000000001',
  '{"rsvp_status":"confirmed","confirmed_pax":6,"side":"groom",
    "arrival":{"date":"2026-12-20","time":"10:30","mode":"air","reference":"6E 5074","point":"Ahmedabad T2","pax":6}}'::jsonb
);

select direction, mode, travel_date, travel_time, reference, point
  from public.travel_legs;

\echo '--- ledger: arrival recorded, departure still missing ---'
select head_name, arrival_legs, departure_legs, ledger_state
  from public.v_travel_ledger where ledger_state <> 'balanced';

\echo '--- calling queue ---'
select head_name, rsvp_status, attempt_count, last_outcome, is_locked
  from public.v_rsvp_queue order by head_name;

\echo '=================================================================='
\echo 'TEST 8  audit log captured everything (admin only)'
\echo '=================================================================='
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
select table_name, action, count(*)
  from public.audit_log group by 1,2 order by 1,2;

reset role;
commit;
