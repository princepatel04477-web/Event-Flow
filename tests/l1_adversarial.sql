-- =====================================================================
-- L1 — ADVERSARIAL SECURITY SUITE
-- =====================================================================
-- Every test here ATTEMPTS A VIOLATION and asserts it is refused.
-- This is the inverse of test_security.sql, which mostly proves the
-- happy path plus a handful of denials.
--
-- SCRATCH DATABASE ONLY. It seeds two events and writes rows into
-- delivery_proofs, which are permanently immutable — never run it
-- against a database holding real guest data.
--
--   docker exec supabase_db_<project> psql -U postgres -d l1_scratch \
--     -f /tmp/l1_adversarial.sql
--
-- Coverage map against TEST-PLAN L1:
--   L1.1  cross-event isolation .......... d (JWT vs other event's rows)
--                                          a/b/c are app-layer, see L1-app
--   L1.2  client role fencing ............ full
--   L1.3  privilege escalation ........... DB-enforced parts
--   L1.4  guarantee bypass ............... full, incl. service_role + superuser
--   L1.5  code brute force ............... NOT HERE — lockout lives in the
--                                          verify-access-code Edge Function
--
-- Denial semantics differ by operation and this suite respects that:
--   SELECT blocked by RLS  -> 0 rows, no error
--   INSERT blocked by RLS  -> 42501
--   UPDATE/DELETE blocked  -> 0 rows affected, no error
--   revoked grant          -> 42501
-- A test that only caught exceptions would score a silent 0-row UPDATE
-- as a pass for the wrong reason, so writes assert on BOTH channels.
-- =====================================================================

\set ON_ERROR_STOP off
\pset pager off
\timing off

-- ---------------------------------------------------------------------
-- Harness
-- ---------------------------------------------------------------------
drop schema if exists l1 cascade;
create schema l1;

create table l1.results (
  seq       serial primary key,
  id        text not null,
  name      text not null,
  expected  text not null,
  actual    text not null,
  result    text not null,
  severity  text not null default 'BLOCKS EVENT'
);

-- security definer so a stripped-down `authenticated` session can still
-- record its own verdict without being granted write access to l1.
create or replace function l1.record(
  p_id text, p_name text, p_expected text, p_actual text,
  p_severity text default 'BLOCKS EVENT'
) returns void
language sql security definer
set search_path = ''
as $$
  insert into l1.results (id, name, expected, actual, result, severity)
  values (p_id, p_name, p_expected, p_actual,
          case when p_expected = p_actual then 'PASS' else 'FAIL' end,
          p_severity);
$$;

grant usage on schema l1 to public;
grant execute on function l1.record(text,text,text,text,text) to public;

-- Classify what happened to a write attempt. Returns 'denied' when the
-- statement raised a privilege error OR silently affected zero rows.
-- 42501 insufficient_privilege · 23514 check_violation · 23503 fk_violation
-- 23505 unique_violation · P0001 raise_exception (our guard triggers)
-- Any other sqlstate is surfaced as denied:<code> so a surprise cannot be
-- mistaken for a clean refusal.
create or replace function l1.write_outcome(p_rows int, p_sqlstate text)
returns text language sql immutable
as $$
  select case
    when p_sqlstate in ('42501','23514','23503','23505','P0001') then 'denied'
    when p_sqlstate is not null then 'denied:' || p_sqlstate
    when p_rows = 0             then 'denied'
    else 'ALLOWED'
  end;
$$;

-- A read is refused either by RLS (zero rows) or by a missing grant
-- (42501). Both are 'no-access'; anything else returns the row count.
create or replace function l1.read_probe(p_table text)
returns text language plpgsql
as $$
declare n int;
begin
  execute format('select count(*) from public.%I', p_table) into n;
  return case when n = 0 then 'no-access' else n::text end;
exception
  when insufficient_privilege then return 'no-access';
  when others then return 'error:' || sqlstate;
end;
$$;
grant execute on function l1.read_probe(text) to public;

-- ---------------------------------------------------------------------
-- SETUP (superuser)
-- ---------------------------------------------------------------------
\echo '=== seeding two events ==='

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@x.com')
on conflict do nothing;

update public.profiles set global_role = 'admin'
 where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.events (id, name, code) values
  ('11111111-1111-1111-1111-111111111111', 'Event A', 'EVENTA26'),
  ('22222222-2222-2222-2222-222222222222', 'Event B', 'EVENTB26');

insert into public.staff_members (id, event_id, full_name) values
  ('33333333-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Staff A'),
  ('33333333-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'Staff B'),
  -- a second active staff member on Event A, for the "frame a colleague" test
  ('33333333-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Someone Else');

insert into public.event_access_codes (id, event_id, role, code_hash, code_prefix, last_four) values
  ('44444444-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'team',   'hash-a-team',   'E', '1111'),
  ('44444444-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111', 'client', 'hash-a-client', 'C', '2222'),
  ('44444444-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222', 'team',   'hash-b-team',   'E', '3333');

insert into public.guest_groups (id, event_id, head_name, primary_mobile, expected_pax, needs_return_gift) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Head A', '9876543210', 6, true),
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'Head B', '9000000000', 4, false);

insert into public.guests (id, event_id, group_id, full_name, is_head) values
  ('a1a1a1a1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Head A', true),
  ('a1a1a1a1-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001', 'Member A2', false),
  ('b1b1b1b1-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'bbbbbbbb-0000-0000-0000-000000000001', 'Head B', true);

insert into public.hotels (id, event_id, name) values
  ('55555555-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Hyatt A');

insert into public.rooms (id, event_id, hotel_id, room_number, capacity, max_capacity) values
  ('66666666-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   '55555555-0000-0000-0000-00000000000a', '205', 2, 3);

insert into public.deliverables (id, event_id, kind, group_id, room_id) values
  ('77777777-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'hamper',
   'aaaaaaaa-0000-0000-0000-000000000001', '66666666-0000-0000-0000-00000000000a');

-- One proof to attack. Insert as superuser to sidestep the RLS insert
-- check; the point of L1.4 is that it cannot be changed afterwards.
insert into public.delivery_proofs (id, event_id, deliverable_id, storage_path, captured_by_staff) values
  ('88888888-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   '77777777-0000-0000-0000-00000000000a',
   '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/seed.jpg',
   '33333333-0000-0000-0000-00000000000a');

-- Evidence-chain rows for the client-fencing tests.
insert into public.call_attempts (id, event_id, group_id, dialed_number, caller_id_staff) values
  ('99999999-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', '9876543210', '33333333-0000-0000-0000-00000000000a');

insert into public.call_recordings (id, event_id, call_attempt_id, group_id, storage_path, uploaded_by_staff) values
  ('99999999-0000-0000-0000-00000000000b', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111/aaaaaaaa-0000-0000-0000-000000000001/rec.m4a',
   '33333333-0000-0000-0000-00000000000a');

insert into public.transcripts (id, event_id, recording_id, text) values
  ('99999999-0000-0000-0000-00000000000c', '11111111-1111-1111-1111-111111111111',
   '99999999-0000-0000-0000-00000000000b', 'six people coming on the 20th');

insert into public.rsvp_extractions (id, event_id, group_id, transcript_id, parsed) values
  ('99999999-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111',
   'aaaaaaaa-0000-0000-0000-000000000001', '99999999-0000-0000-0000-00000000000c',
   '{"rsvp_status":"confirmed","confirmed_pax":6}'::jsonb);

\echo ''
\echo '=================================================================='
\echo 'L1.1d  Event A team JWT against Event B rows'
\echo '=================================================================='

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000a"}';
set role authenticated;

-- CONTROL first: this session must be able to see its OWN event, or
-- every denial below is meaningless.
do $$
declare n int;
begin
  begin
    select count(*) into n from public.guest_groups
     where event_id = '11111111-1111-1111-1111-111111111111';
  exception when insufficient_privilege then n := 0;
  end;
  perform l1.record('L1.1d-CONTROL', 'CONTROL: Team A reads its OWN event''s groups',
                    'rows>0', case when n > 0 then 'rows>0' else '0' end);
end $$;

-- read
do $$
declare n int;
begin
  begin
    select count(*) into n from public.guest_groups
     where event_id = '22222222-2222-2222-2222-222222222222';
  exception when insufficient_privilege then n := 0;
  end;
  perform l1.record('L1.1d-read', 'Team A reads Event B guest_groups',
                    '0', n::text);
end $$;

do $$
declare n int;
begin
  begin
    select count(*) into n from public.events
     where id = '22222222-2222-2222-2222-222222222222';
  exception when insufficient_privilege then n := 0;
  end;
  perform l1.record('L1.1d-event', 'Team A can see Event B exists',
                    '0', n::text);
end $$;

-- insert into the other event (the classic tampered-payload attack)
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.travel_legs (event_id, group_id, direction, mode)
    values ('22222222-2222-2222-2222-222222222222',
            'bbbbbbbb-0000-0000-0000-000000000001', 'arrival', 'air');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.1d-insert', 'Team A inserts a travel_leg into Event B',
                    'denied', l1.write_outcome(n, s));
end $$;

-- update a row belonging to the other event
do $$
declare n int := -1; s text;
begin
  begin
    update public.guest_groups set confirmed_pax = 99
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.1d-update', 'Team A updates Event B guest_group',
                    'denied', l1.write_outcome(n, s));
end $$;

-- smuggle a child row under Event A's id but pointing at Event B's parent
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.guests (event_id, group_id, full_name)
    values ('11111111-1111-1111-1111-111111111111',
            'bbbbbbbb-0000-0000-0000-000000000001', 'Smuggled');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.1d-fk', 'Team A attaches a guest to Event B''s group via composite FK',
                    'denied', l1.write_outcome(n, s));
end $$;

reset role;

\echo ''
\echo '=================================================================='
\echo 'L1.2  Client session must read NOTHING sensitive, write NOTHING'
\echo '=================================================================='

set request.jwt.claims = '{"role":"authenticated","app_role":"client","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000c"}';
set role authenticated;

do $$
declare
  t text;
  tables text[] := array[
    'transcripts','call_recordings','rsvp_extractions','event_access_codes',
    'staff_members','admin_devices','call_attempts','delivery_proofs',
    'login_attempt_log','code_reveal_log','audit_log','profiles','guest_groups'
  ];
begin
  foreach t in array tables loop
    perform l1.record('L1.2-read-' || t,
                      format('Client reads %s', t),
                      'no-access', l1.read_probe(t));
  end loop;
end $$;

-- the one view a client IS allowed
do $$
declare n int;
begin
  select count(*) into n from public.client_guest_profiles;
  perform l1.record('L1.2-view', 'Client reads client_guest_profiles (allowed)',
                    'rows>0', case when n > 0 then 'rows>0' else '0' end, 'ANNOYING');
end $$;

-- writes
do $$
declare n int := -1; s text;
begin
  begin
    update public.guest_groups set confirmed_pax = 42
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.2-write-update', 'Client updates a guest_group',
                    'denied', l1.write_outcome(n, s));
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    insert into public.guest_groups (event_id, head_name, expected_pax)
    values ('11111111-1111-1111-1111-111111111111', 'Client Injected', 1);
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.2-write-insert', 'Client inserts a guest_group',
                    'denied', l1.write_outcome(n, s));
end $$;

reset role;

\echo ''
\echo '=================================================================='
\echo 'L1.3  Privilege escalation from a team session'
\echo '=================================================================='

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000a"}';
set role authenticated;

do $$
declare n int := -1; s text;
begin
  begin
    insert into public.events (name, code) values ('Team Made This', 'HACK26');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.3-create-event', 'Team creates an event',
                    'denied', l1.write_outcome(n, s));
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    insert into public.event_access_codes (event_id, role, code_hash, code_prefix, last_four)
    values ('11111111-1111-1111-1111-111111111111', 'client', 'forged', 'C', '9999');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.3-mint-code', 'Team mints an access code',
                    'denied', l1.write_outcome(n, s));
end $$;

do $$
begin
  perform l1.record('L1.3-read-codes', 'Team reads event_access_codes',
                    'no-access', l1.read_probe('event_access_codes'));
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    update public.profiles set global_role = 'admin'
     where id = '00000000-0000-0000-0000-0000000000a1';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.3-self-promote', 'Team promotes a profile to admin',
                    'denied', l1.write_outcome(n, s));
end $$;

-- admin-only RPCs
do $$
declare s text;
begin
  begin
    perform app.rotate_access_code('44444444-0000-0000-0000-00000000000a', 'newhash', '5555');
    s := null;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.3-rotate', 'Team calls app.rotate_access_code',
                    'denied', case when s is null then 'ALLOWED' else 'denied' end);
end $$;

do $$
declare s text;
begin
  begin
    perform app.revoke_access_code('44444444-0000-0000-0000-00000000000a');
    s := null;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.3-revoke', 'Team calls app.revoke_access_code',
                    'denied', case when s is null then 'ALLOWED' else 'denied' end);
end $$;

reset role;

\echo ''
\echo '=================================================================='
\echo 'L1.4  Guarantee bypass — the ones that must hold against everyone'
\echo '=================================================================='

-- ---- as an ordinary team session -----------------------------------
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000a"}';
set role authenticated;

do $$
declare n int := -1; s text;
begin
  begin
    update public.delivery_proofs set notes = 'tampered'
     where id = '88888888-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-update-team', 'Team UPDATEs a delivery_proof',
                    'denied', l1.write_outcome(n, s));
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    delete from public.delivery_proofs
     where id = '88888888-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-delete-team', 'Team DELETEs a delivery_proof',
                    'denied', l1.write_outcome(n, s));
end $$;

reset role;

-- ---- as service_role (bypasses RLS; only the trigger can stop it) ---
set request.jwt.claims = '{"role":"service_role"}';
set role service_role;

do $$
declare n int := -1; s text;
begin
  begin
    update public.delivery_proofs set notes = 'tampered by service role'
     where id = '88888888-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-update-service', 'service_role UPDATEs a delivery_proof',
                    'denied', l1.write_outcome(n, s));
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    delete from public.delivery_proofs
     where id = '88888888-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-delete-service', 'service_role DELETEs a delivery_proof',
                    'denied', l1.write_outcome(n, s));
end $$;

reset role;

-- ---- as the database superuser (the strongest possible attacker) ----
do $$
declare n int := -1; s text;
begin
  begin
    update public.delivery_proofs set notes = 'tampered by superuser'
     where id = '88888888-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-update-superuser', 'superuser UPDATEs a delivery_proof',
                    'denied', l1.write_outcome(n, s));
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    delete from public.delivery_proofs
     where id = '88888888-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-delete-superuser', 'superuser DELETEs a delivery_proof',
                    'denied', l1.write_outcome(n, s));
end $$;

-- ---- server clock beats the phone's claim --------------------------
do $$
declare v_recorded timestamptz; v_device timestamptz;
begin
  insert into public.delivery_proofs
    (event_id, deliverable_id, storage_path, recorded_at, device_captured_at, captured_by_staff)
  values
    ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
     '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/clock.jpg',
     '2030-01-01T00:00:00Z', '2030-01-01T00:00:00Z',
     '33333333-0000-0000-0000-00000000000a')
  returning recorded_at, device_captured_at into v_recorded, v_device;

  perform l1.record('L1.4-clock-recorded',
    'Phone claiming 2030 gets server now() in recorded_at',
    'server-now',
    case when v_recorded < now() + interval '1 minute'
              and v_recorded > now() - interval '1 minute'
         then 'server-now' else 'phone-time:' || v_recorded::text end);

  perform l1.record('L1.4-clock-device',
    'The phone''s claim is preserved in device_captured_at',
    '2030', to_char(v_device, 'YYYY'));
end $$;

-- ---- room overlap guard --------------------------------------------
do $$
declare n int := -1; s text;
begin
  insert into public.room_assignments
    (event_id, room_id, guest_id, group_id, check_in_date, check_out_date, assigned_by_staff)
  values
    ('11111111-1111-1111-1111-111111111111', '66666666-0000-0000-0000-00000000000a',
     'a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
     '2026-12-20', '2026-12-24', '33333333-0000-0000-0000-00000000000a');

  begin
    insert into public.room_assignments
      (event_id, room_id, guest_id, group_id, check_in_date, check_out_date, assigned_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '66666666-0000-0000-0000-00000000000a',
       'a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
       '2026-12-22', '2026-12-26', '33333333-0000-0000-0000-00000000000a');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;

  perform l1.record('L1.4-room-overlap',
    'Overlapping stay in the same room is refused',
    'denied', l1.write_outcome(n, s));
end $$;

-- non-overlapping must still be allowed, or the guard is too strict
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.room_assignments
      (event_id, room_id, guest_id, group_id, check_in_date, check_out_date, assigned_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '66666666-0000-0000-0000-00000000000a',
       'a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
       '2026-12-24', '2026-12-28', '33333333-0000-0000-0000-00000000000a');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-room-adjacent',
    'Back-to-back stay (checkout day = checkin day) is allowed',
    'ALLOWED', l1.write_outcome(n, s), 'ANNOYING');
end $$;

-- ---- attribution pair CHECK ----------------------------------------
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path, captured_by, captured_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/both.jpg',
       '00000000-0000-0000-0000-0000000000a1', '33333333-0000-0000-0000-00000000000a');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-attrib-both',
    'DB backstop: BOTH attribution columns set (RLS bypassed)',
    'denied', l1.write_outcome(n, s), 'AFTER');
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/neither.jpg');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-attrib-neither',
    'DB backstop: NEITHER attribution column set (RLS bypassed)',
    'denied', l1.write_outcome(n, s), 'AFTER');
end $$;

-- ---- attribution through a REAL team session (RLS enforced) ---------
-- The superuser probes above bypass RLS, so they only prove the CHECK
-- is absent. What decides severity is whether the app path itself can
-- write an ambiguous proof. The INSERT policy reads:
--   captured_by_staff = jwt_staff_member_id()
--   OR (captured_by_staff IS NULL AND captured_by = auth.uid())
-- The first disjunct says nothing about captured_by, so setting BOTH
-- may satisfy it. This test settles that.
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000a"}';
set role authenticated;

do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path, captured_by, captured_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/rls-both.jpg',
       '00000000-0000-0000-0000-0000000000a1',   -- the admin's uid, not mine
       '33333333-0000-0000-0000-00000000000a');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-attrib-both-rls',
    'Team session writes a proof blaming BOTH itself and the admin',
    'denied', l1.write_outcome(n, s));
end $$;

-- POSITIVE CONTROL. Without this, every denial above could simply mean
-- "a team session cannot insert proofs at all" and the whole L1.4-rls
-- block would be green for the wrong reason. This mirrors exactly what
-- src/lib/proof.ts:270 sends for a code-auth session.
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path, captured_by, captured_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/control.jpg',
       null, '33333333-0000-0000-0000-00000000000a');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-CONTROL-proof-insert',
    'CONTROL: a legitimate team proof insert SUCCEEDS',
    'ALLOWED', l1.write_outcome(n, s));
end $$;

-- Unattributed: both columns explicitly null. Must be refused, or an
-- immutable row exists that nobody can be held to.
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path, captured_by, captured_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/rls-neither.jpg',
       null, null);
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  -- Before 20260809130000 this was refused outright. Now
  -- app.route_attribution fills the staff column from the session, which
  -- is the better outcome: the row lands ATTRIBUTED rather than rejected.
  -- Assert the identity it landed on, not merely that the insert ran —
  -- "allowed" alone would not distinguish routing from a silent null.
  perform l1.record('L1.4-attrib-neither-rls',
    'Unattributed proof insert is routed to the acting staff member',
    'routed-to-session-staff',
    case
      when l1.write_outcome(n, s) <> 'ALLOWED' then 'denied'
      else (
        select case
          when p.captured_by_staff = '33333333-0000-0000-0000-00000000000a'
               and p.captured_by is null then 'routed-to-session-staff'
          when p.captured_by_staff is null and p.captured_by is null then 'UNATTRIBUTED'
          else 'wrong-identity'
        end
        from public.delivery_proofs p
        where p.storage_path like '%rls-neither.jpg'
      )
    end);
end $$;

-- The stale default: captured_by DEFAULTs to app.current_identity(),
-- which returns a staff_members.id for a code session — a value that
-- cannot satisfy captured_by's FK to auth.users. Every sibling table
-- got app.route_attribution in 20260808100000 to fix exactly this;
-- delivery_proofs did not. The app dodges it by sending an explicit
-- captured_by: null (src/lib/proof.ts:270), so this is latent, not
-- live — but nothing in the database enforces that.
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path, captured_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/rls-default.jpg',
       '33333333-0000-0000-0000-00000000000a');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-attrib-stale-default',
    'Team proof insert that omits captured_by (relies on the column default)',
    'ALLOWED', l1.write_outcome(n, s));
end $$;

-- After 20260809130000, an omitted pair must be ROUTED to the staff
-- column rather than defaulted into captured_by. Assert the routing
-- landed on the right column, not merely that the insert succeeded.
do $$
declare v_by uuid; v_staff uuid;
begin
  select captured_by, captured_by_staff into v_by, v_staff
    from public.delivery_proofs
   where storage_path like '%rls-default.jpg';

  perform l1.record('L1.4-attrib-routed',
    'Omitted attribution is routed to captured_by_staff, not captured_by',
    'staff-only',
    case
      when v_staff is null and v_by is null then 'unattributed'
      when v_by is not null and v_staff is not null then 'BOTH'
      when v_by is not null then 'auth-only'
      else 'staff-only'
    end);
end $$;

-- Attribute the proof to a DIFFERENT staff member on the same event.
do $$
declare n int := -1; s text;
begin
  begin
    insert into public.delivery_proofs
      (event_id, deliverable_id, storage_path, captured_by_staff)
    values
      ('11111111-1111-1111-1111-111111111111', '77777777-0000-0000-0000-00000000000a',
       '11111111-1111-1111-1111-111111111111/77777777-0000-0000-0000-00000000000a/rls-framed.jpg',
       '33333333-0000-0000-0000-00000000000d');
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-attrib-frame',
    'Team session pins its proof on a different staff member',
    'denied', l1.write_outcome(n, s));
end $$;

reset role;

-- ---- call_attempts one-shot completion ------------------------------
do $$
declare n int := -1; s text; v_outcome text;
begin
  update public.call_attempts
     set outcome = 'connected', ended_at = now()
   where id = '99999999-0000-0000-0000-00000000000a';

  begin
    update public.call_attempts
       set outcome = 'declined'
     where id = '99999999-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;

  select outcome into v_outcome from public.call_attempts
   where id = '99999999-0000-0000-0000-00000000000a';

  perform l1.record('L1.4-call-frozen',
    'A finalized call_attempt cannot be re-outcomed',
    'connected', v_outcome);
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    delete from public.call_attempts
     where id = '99999999-0000-0000-0000-00000000000a';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L1.4-call-delete',
    'A call_attempt cannot be deleted',
    'denied', l1.write_outcome(n, s));
end $$;

\echo ''
\echo '=================================================================='
\echo 'L5.1  Revocation and rotation must end a live session'
\echo '=================================================================='
-- Confirmed broken against the live project on 2026-08-09: a session
-- kept full read AND write access after its code was revoked. These
-- assertions fail against any build before 20260809140000.

-- CONTROL: the session works while its code is live.
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000a"}';
set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.guest_groups;
  perform l1.record('L5.1-CONTROL', 'CONTROL: live code -> session reads',
                    'rows>0', case when n > 0 then 'rows>0' else '0' end);
end $$;
reset role;

update public.event_access_codes set revoked_at = now()
 where id = '44444444-0000-0000-0000-00000000000a';

set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.guest_groups;
  perform l1.record('L5.1-revoked-read', 'Revoked code -> session cannot read',
                    '0', n::text);
end $$;

do $$
declare n int := -1; s text;
begin
  begin
    update public.guest_groups set confirmed_pax = 7
     where id = 'aaaaaaaa-0000-0000-0000-000000000001';
    get diagnostics n = row_count;
  exception when others then s := sqlstate;
  end;
  perform l1.record('L5.1-revoked-write', 'Revoked code -> session cannot write',
                    'denied', l1.write_outcome(n, s));
end $$;
reset role;

-- Rotation must retire the old row and mint a replacement, so sessions
-- from the retired row die too. (Previously it stamped rotated_at then
-- immediately nulled it on the same row, marking nothing.)
update public.event_access_codes set revoked_at = null
 where id = '44444444-0000-0000-0000-00000000000a';

do $$
declare v_new uuid; v_old_rotated timestamptz;
begin
  set local role postgres;
  perform set_config('request.jwt.claims',
    '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}', true);

  v_new := app.rotate_access_code('44444444-0000-0000-0000-00000000000a',
                                  'rotated-hash', '7777');

  select rotated_at into v_old_rotated from public.event_access_codes
   where id = '44444444-0000-0000-0000-00000000000a';

  perform l1.record('L5.1-rotate-stamps-old',
    'Rotation stamps rotated_at on the OLD row', 'stamped',
    case when v_old_rotated is not null then 'stamped' else 'NOT-STAMPED' end);

  perform l1.record('L5.1-rotate-makes-new',
    'Rotation inserts a replacement row', 'new-row',
    case when v_new is not null and v_new <> '44444444-0000-0000-0000-00000000000a'
         then 'new-row' else 'NO-NEW-ROW' end);
end $$;

set role authenticated;
do $$
declare n int;
begin
  select count(*) into n from public.guest_groups;
  perform l1.record('L5.1-rotated-read', 'Rotated code -> old session cannot read',
                    '0', n::text);
end $$;
reset role;

\echo ''
\echo '=================================================================='
\echo 'SCOREBOARD'
\echo '=================================================================='

select id, name, expected, actual, result, severity
  from l1.results order by seq;

\echo ''
select result, count(*) from l1.results group by result order by result;

\echo ''
\echo '--- FAILURES ---'
select id, name, expected as "expected", actual as "got", severity
  from l1.results where result = 'FAIL' order by seq;
