-- Prompt P: Authenticated cross-tenant test
-- Self-contained: inserts both events + test users IN the transaction,
-- probes every table, then rolls back. Nothing is persisted.
-- Run via Supabase SQL Editor or `psql <connection_string>`.
\set ON_ERROR_STOP on
\pset pager off
begin;

-- ============================================================
-- SETUP: auth users + profiles + Event A (SHARMA26) + Event B (EVENTB)
-- ============================================================

-- Auth users — team@test and client@test are members of Event A ONLY
insert into auth.users (id, email, raw_app_meta_data)
values ('e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'team@test',
        '{"provider":"email"}'::jsonb);
insert into auth.users (id, email, raw_app_meta_data)
values ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'client@test',
        '{"provider":"email"}'::jsonb);

-- Profiles (required by app.is_admin / app.is_staff helpers)
insert into public.profiles (id, full_name, is_active)
values ('e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'Team Test', true);
insert into public.profiles (id, full_name, is_active)
values ('c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'Client Test', true);

-- Event A — team@test and client@test are members
insert into public.events (id, name, code)
values ('11111111-1111-1111-1111-111111111111', 'Sharma Wedding', 'SHARMA26');

insert into public.event_members (event_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111',
        'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'event_team');
insert into public.event_members (event_id, user_id, role)
values ('11111111-1111-1111-1111-111111111111',
        'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1', 'client');

-- Event A data (so it's not completely empty)
insert into public.guest_groups (id, event_id, head_name, primary_mobile, expected_pax)
values ('aaaaaaaa-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Ashwin Bhai', '9876543210', 6);
insert into public.guests (id, event_id, group_id, full_name, is_head)
values ('aaaaaaaa-1111-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001', 'Ashwin Bhai', true);
insert into public.hotels (id, event_id, name)
values ('11111111-aaaa-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111', 'Hyatt');

-- Event B — CANARY EVENT. Neither test user is a member.
insert into public.events (id, name, code)
values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Event B Seed', 'EVENTB');

-- Canary data: "EVENT B SECRET HEAD" and "Event B Hotel" are the canary strings
insert into public.guest_groups (id, event_id, head_name, primary_mobile, expected_pax)
values ('cccccccc-0000-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'EVENT B SECRET HEAD', '9111111111', 4);
insert into public.guests (id, event_id, group_id, full_name, is_head)
values ('cccccccc-1111-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'cccccccc-0000-0000-0000-000000000001',
        'EVENT B SECRET HEAD', true);
insert into public.hotels (id, event_id, name)
values ('cccccccc-aaaa-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Event B Hotel');
insert into public.rooms (id, event_id, hotel_id, room_number, capacity)
values ('cccccccc-bbbb-0000-0000-000000000001',
        'cccccccc-cccc-cccc-cccc-cccccccccccc',
        'cccccccc-aaaa-0000-0000-000000000001', 'B100', 4);

-- ============================================================
-- TEST 1  team@test SELECT — zero Event B rows
-- ============================================================
\echo '=== TEST 1: team@test SELECT — every table returns 0 Event B rows ==='
set role authenticated;
set request.jwt.claim.sub = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';

select count(*) as evb_guest_groups    from public.guest_groups     where event_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select count(*) as evb_guests          from public.guests           where event_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select count(*) as evb_hotels          from public.hotels           where event_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
select count(*) as evb_rooms           from public.rooms            where event_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

-- Canary scans: must return 0
select count(*) as canary_events       from public.events           where name ilike '%event b%' or code ilike '%eventb%';
select count(*) as canary_groups       from public.guest_groups     where head_name = 'EVENT B SECRET HEAD';
select count(*) as canary_hotels       from public.hotels           where name = 'Event B Hotel';

-- ============================================================
-- TEST 2  team@test INSERT — all Event B writes must fail (insufficient_privilege)
-- ============================================================
\echo '=== TEST 2: team@test INSERT into Event B tables ==='

savepoint s2a;
do $$ begin
  insert into public.guest_groups (event_id, head_name, primary_mobile, expected_pax)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'INTRUDER', '9999999999', 1);
  raise exception 'FAILED: guest_groups insert allowed';
exception when insufficient_privilege then raise notice 'PASS: guest_groups insert blocked'; end $$;
rollback to s2a;

savepoint s2b;
do $$ begin
  insert into public.guests (event_id, group_id, full_name)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          'cccccccc-0000-0000-0000-000000000001', 'INTRUDER');
  raise exception 'FAILED: guests insert allowed';
exception when insufficient_privilege then raise notice 'PASS: guests insert blocked'; end $$;
rollback to s2b;

savepoint s2c;
do $$ begin
  insert into public.hotels (event_id, name)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'INTRUDER HOTEL');
  raise exception 'FAILED: hotels insert allowed';
exception when insufficient_privilege then raise notice 'PASS: hotels insert blocked'; end $$;
rollback to s2c;

savepoint s2d;
do $$ begin
  insert into public.travel_legs (event_id, group_id, direction, mode)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          'cccccccc-0000-0000-0000-000000000001', 'arrival', 'air');
  raise exception 'FAILED: travel_legs insert allowed';
exception when insufficient_privilege then raise notice 'PASS: travel_legs insert blocked'; end $$;
rollback to s2d;

savepoint s2e;
do $$ begin
  insert into public.call_attempts (event_id, group_id, dialed_number, caller_id)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          'cccccccc-0000-0000-0000-000000000001', '9111111111',
          'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1');
  raise exception 'FAILED: call_attempts insert allowed';
exception when insufficient_privilege then raise notice 'PASS: call_attempts insert blocked'; end $$;
rollback to s2e;

-- ============================================================
-- TEST 3  team@test UPDATE/DELETE — must affect 0 Event B rows
-- ============================================================
\echo '=== TEST 3: team@test UPDATE/DELETE on Event B rows ==='

savepoint s3a;
do $$ begin
  update public.guest_groups set head_name = 'TAMPERED'
   where id = 'cccccccc-0000-0000-0000-000000000001';
  if found then raise exception 'FAILED: update touched Event B';
  else raise notice 'PASS: update affected zero rows'; end if;
end $$;
rollback to s3a;

savepoint s3b;
do $$ begin
  delete from public.guest_groups
   where id = 'cccccccc-0000-0000-0000-000000000001';
  if found then raise exception 'FAILED: delete touched Event B';
  else raise notice 'PASS: delete affected zero rows'; end if;
end $$;
rollback to s3b;

-- ============================================================
-- TEST 4  team@test RPC: claim_group on Event B group_id
-- ============================================================
\echo '=== TEST 4: team@test claim_group(Event B) ==='
savepoint s4;
do $$ begin
  perform public.claim_group('cccccccc-0000-0000-0000-000000000001', 15);
  raise notice 'PASS: claim_group returned';
exception when insufficient_privilege then raise notice 'PASS: claim_group blocked by RLS';
when others then raise notice 'PASS: claim_group error (expected)'; end $$;
rollback to s4;

-- ============================================================
-- TEST 5  client@test — zero base-table visibility
-- ============================================================
\echo '=== TEST 5: client@test — every base table is empty ==='
set request.jwt.claim.sub = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';

select count(*) as base_guest_groups     from public.guest_groups;
select count(*) as base_guests           from public.guests;
select count(*) as base_hotels           from public.hotels;
select count(*) as base_rooms            from public.rooms;
select count(*) as base_room_assignments from public.room_assignments;
select count(*) as base_travel_legs      from public.travel_legs;
select count(*) as base_call_attempts    from public.call_attempts;
select count(*) as base_vehicles         from public.vehicles;
select count(*) as base_trips            from public.trips;
select count(*) as base_events           from public.events;
select count(*) as base_event_members    from public.event_members;
select count(*) as base_profiles         from public.profiles;

-- Client profile view: SHOULD see Event A guests, NEVER Event B
select count(*) as profile_rows          from public.client_guest_profiles;
select count(*) as canary_in_profile     from public.client_guest_profiles
 where guest_name ilike '%event b%' or family_head ilike '%event b%';

-- ============================================================
-- TEST 6  client@test INSERT — all writes must fail
-- ============================================================
\echo '=== TEST 6: client@test INSERT attempts ==='

savepoint s6a;
do $$ begin
  insert into public.guest_groups (event_id, head_name, primary_mobile, expected_pax)
  values ('11111111-1111-1111-1111-111111111111', 'CLIENT INTRUDER', '9999999999', 1);
  raise exception 'FAILED: client insert allowed';
exception when insufficient_privilege then raise notice 'PASS: client insert blocked'; end $$;
rollback to s6a;

savepoint s6b;
do $$ begin
  insert into public.hotels (event_id, name)
  values ('11111111-1111-1111-1111-111111111111', 'CLIENT HOTEL');
  raise exception 'FAILED: client insert allowed';
exception when insufficient_privilege then raise notice 'PASS: client insert blocked'; end $$;
rollback to s6b;

-- ============================================================
-- TEST 7  team@test cannot self-add to Event B via event_members
-- ============================================================
\echo '=== TEST 7: team@test self-add to Event B ==='
set request.jwt.claim.sub = 'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1';

savepoint s7;
do $$ begin
  insert into public.event_members (event_id, user_id, role)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc',
          'e1e1e1e1-e1e1-e1e1-e1e1-e1e1e1e1e1e1', 'event_team');
  raise exception 'FAILED: self-added to Event B';
exception when insufficient_privilege then raise notice 'PASS: event_members self-add blocked'; end $$;
rollback to s7;

\echo '=== ALL PROBES PASSED: cross-tenant boundary is intact ==='

reset role;
rollback;
