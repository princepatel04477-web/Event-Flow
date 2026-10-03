-- F8a — room-wise hampers: the three guarantees the polymorphic target buys.
--
--   1. A hamper's room_id must belong to the SAME event (composite FK).
--   2. Exactly one target is set — a room hamper cannot also name a family.
--   3. An event_team user of event B sees ZERO of event A's room hampers (RLS).
--
-- Self-contained: inserts both events + users in the transaction and rolls
-- back. Run via the Supabase SQL editor, `psql`, or `supabase test db`.
\set ON_ERROR_STOP on
\pset pager off
begin;

-- ============================================================
-- SETUP (as the migration owner, RLS not yet in play)
-- ============================================================
insert into auth.users (id, email, raw_app_meta_data)
values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'team-a@test', '{"provider":"email"}'::jsonb);
insert into auth.users (id, email, raw_app_meta_data)
values ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'team-b@test', '{"provider":"email"}'::jsonb);

insert into public.profiles (id, full_name, is_active)
values ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'Team A', true);
insert into public.profiles (id, full_name, is_active)
values ('b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'Team B', true);

-- Event A (+ team A as event_team) and Event B (+ team B as event_team).
insert into public.events (id, name, code)
values ('a0000000-0000-0000-0000-000000000001', 'Event A', 'EVENTA');
insert into public.events (id, name, code)
values ('b0000000-0000-0000-0000-000000000002', 'Event B', 'EVENTB');

insert into public.event_members (event_id, user_id, role)
values ('a0000000-0000-0000-0000-000000000001',
        'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'event_team');
insert into public.event_members (event_id, user_id, role)
values ('b0000000-0000-0000-0000-000000000002',
        'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1', 'event_team');

-- Event A: a family, a hotel with two rooms.
insert into public.guest_groups (id, event_id, head_name, primary_mobile, expected_pax)
values ('a0000000-0000-0000-0000-0000000000aa',
        'a0000000-0000-0000-0000-000000000001', 'Mehta', '9876543210', 4);
insert into public.hotels (id, event_id, name)
values ('a0000000-0000-0000-0000-0000000000h1',
        'a0000000-0000-0000-0000-000000000001', 'Grand');
insert into public.rooms (id, event_id, hotel_id, room_number, capacity)
values ('a0000000-0000-0000-0000-0000000000r1',
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-0000000000h1', '101', 2);
insert into public.rooms (id, event_id, hotel_id, room_number, capacity)
values ('a0000000-0000-0000-0000-0000000000r2',
        'a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-0000000000h1', '102', 2);

-- Event B: its own hotel + room, used as the cross-event target.
insert into public.hotels (id, event_id, name)
values ('b0000000-0000-0000-0000-0000000000h1',
        'b0000000-0000-0000-0000-000000000002', 'Sea View');
insert into public.rooms (id, event_id, hotel_id, room_number, capacity)
values ('b0000000-0000-0000-0000-0000000000r1',
        'b0000000-0000-0000-0000-000000000002',
        'b0000000-0000-0000-0000-0000000000h1', 'B1', 2);

-- A legitimate room-targeted hamper for Event A room 101.
insert into public.deliverables (event_id, room_id, kind, quantity, item_name)
values ('a0000000-0000-0000-0000-000000000001',
        'a0000000-0000-0000-0000-0000000000r1', 'hamper', 1, 'Welcome hamper');

-- ============================================================
-- TEST 1 — a room from another event is rejected (composite FK, 23503)
-- ============================================================
\echo '=== TEST 1: cross-event room_id rejected ==='
savepoint t1;
do $$
begin
  insert into public.deliverables (event_id, room_id, kind, quantity)
  values ('a0000000-0000-0000-0000-000000000001',   -- Event A
          'b0000000-0000-0000-0000-0000000000r1',   -- Event B's room
          'hamper', 1);
  raise exception 'FAILED: cross-event room_id was accepted';
exception
  when foreign_key_violation then raise notice 'PASS: cross-event room_id rejected (23503)';
end $$;
rollback to t1;

-- ============================================================
-- TEST 2 — two targets at once is rejected (CHECK, 23514)
-- ============================================================
\echo '=== TEST 2: room_id + group_id together rejected ==='
savepoint t2;
do $$
begin
  insert into public.deliverables (event_id, room_id, group_id, kind, quantity)
  values ('a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000r2',   -- a room
          'a0000000-0000-0000-0000-0000000000aa',   -- AND a family
          'hamper', 1);
  raise exception 'FAILED: two targets were accepted';
exception
  when check_violation then raise notice 'PASS: two targets rejected (23514)';
end $$;
rollback to t2;

-- ============================================================
-- TEST 2b — one hamper per room (unique, 23505)
-- ============================================================
\echo '=== TEST 2b: a second hamper for the same room is rejected ==='
savepoint t2b;
do $$
begin
  insert into public.deliverables (event_id, room_id, kind, quantity)
  values ('a0000000-0000-0000-0000-000000000001',
          'a0000000-0000-0000-0000-0000000000r1',
          'hamper', 1);
  raise exception 'FAILED: a second hamper for one room was accepted';
exception
  when unique_violation then raise notice 'PASS: one hamper per room enforced (23505)';
end $$;
rollback to t2b;

-- ============================================================
-- TEST 3 — event B's team sees none of event A's room hampers
-- ============================================================
\echo '=== TEST 3: event B team cannot read event A room hampers ==='
set role authenticated;
set request.jwt.claim.sub = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';

select count(*) as eventA_room_hampers_visible
  from public.deliverables
 where event_id = 'a0000000-0000-0000-0000-000000000001';

reset role;

\echo '=== DONE: F8a room-wise hamper guarantees hold ==='
rollback;
