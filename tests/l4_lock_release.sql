-- =====================================================================
-- L4 — caller lock: release_group only ever releases what you hold
-- =====================================================================
--   bash tests/run-l4.sh
--
-- REGRESSION GUARD for migration 20260813000000. Before that migration
-- release_group's WHERE ended in `or app.is_admin()`, which made it an
-- unconditional override rather than a holder check: any admin session
-- calling release_group cleared whichever caller currently held the lock.
--
-- The invariant this suite pins down:
--
--   A session that does NOT hold the lock cannot clear it — being an
--   admin is not the same as being the holder.
--
-- Probes:
--   C0  caller A really holds the lock after claim_group  (false-green guard)
--   R1  a non-admin colleague releases  -> A keeps the lock   (CONTROL)
--   C1  the R2 session really is an admin                 (false-green guard)
--   R2  an ADMIN releases               -> A keeps the lock   (THE REGRESSION)
--   C4  the admin holds the lock themselves               (false-green guard)
--   R4  the admin releases their OWN lock -> lock is dropped  (over-restriction guard)
--
-- R1 is what makes the signal sharp. R1 and R2 are both staff and neither
-- holds the lock; the only difference between them is is_admin(). R1 green
-- + R2 red isolates the fault to the admin branch and nothing else.
--
-- R4 guards the opposite failure: a fix that over-restricts and stops an
-- admin dropping a lock they genuinely hold.
--
-- The C-probes exist because every assertion here is of the form "the
-- write did NOT happen", and that is exactly the shape that passes for
-- the wrong reason. Without C1, an is_admin() returning false would make
-- R2 green while proving nothing at all.
--
-- NEVER point this at a database holding real guest data.
-- =====================================================================

\set ON_ERROR_STOP on

create schema if not exists repro;
drop table if exists repro.results;
create table repro.results (
  seq       serial primary key,
  id        text,
  name      text,
  expected  text,
  actual    text,
  result    text
);

-- security definer: C1 is recorded from inside the `authenticated` role,
-- which has no grant on repro.results.
create or replace function repro.record(
  p_id text, p_name text, p_expected text, p_actual text
) returns void language sql security definer set search_path = '' as $$
  insert into repro.results (id, name, expected, actual, result)
  values (p_id, p_name, p_expected, p_actual,
          case when p_expected = p_actual then 'PASS' else 'FAIL' end);
$$;
grant usage on schema repro to public;
grant execute on function repro.record(text,text,text,text) to public;

-- Who holds the lock right now, as a stable label.
create or replace function repro.lock_holder(p_group uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when g.locked_until is null or g.locked_until <= now() then 'unlocked'
    when g.locked_by_staff = '33333333-0000-0000-0000-00000000000a' then 'caller-A'
    when g.locked_by_staff = '33333333-0000-0000-0000-00000000000d' then 'caller-D'
    when g.locked_by       is not null then 'auth-user'
    else 'unlocked'
  end
  from public.guest_groups g where g.id = p_group;
$$;
grant execute on function repro.lock_holder(uuid) to public;

-- ---------------------------------------------------------------------
-- SETUP (superuser)
-- ---------------------------------------------------------------------
\echo '=== seeding: one event, two callers, one admin, one family ==='

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@x.com')
on conflict do nothing;

update public.profiles set global_role = 'admin'
 where id = '00000000-0000-0000-0000-0000000000a1';

insert into public.events (id, name, code) values
  ('11111111-1111-1111-1111-111111111111', 'Event A', 'EVENTA26');

insert into public.staff_members (id, event_id, full_name) values
  ('33333333-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Caller A'),
  ('33333333-0000-0000-0000-00000000000d', '11111111-1111-1111-1111-111111111111', 'Caller D');

-- ONE live team code per event (event_access_codes_one_live_per_role is a
-- partial unique index over live codes). That is how production works: the
-- whole calling team shares the event's team code, and the individual is
-- the staff_member_id they picked at sign-in. So A and D differ only by
-- staff_member_id, which is precisely the identity release_group compares.
insert into public.event_access_codes (id, event_id, role, code_hash, code_prefix, last_four) values
  ('44444444-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'team', 'hash-a', 'E', '1111');

insert into public.guest_groups (id, event_id, head_name, primary_mobile, expected_pax) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Head A', '9876543210', 6);

-- ---------------------------------------------------------------------
-- Caller A claims the family, exactly as /rsvp/status/[groupId] does.
-- ---------------------------------------------------------------------
\echo '=== caller A claims the family ==='

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000a"}';
set role authenticated;

do $$ begin perform public.claim_group('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 15); end $$;

reset role;
reset request.jwt.claims;

-- C0 false-green guard: if the claim did not take, every "lock survived"
-- assertion below would be meaningless.
do $$ begin perform repro.record(
  'C0', 'CONTROL: caller A actually holds the lock after claim_group',
  'caller-A',
  repro.lock_holder('aaaaaaaa-0000-0000-0000-000000000001')
); end $$;

-- ---------------------------------------------------------------------
-- R1 CONTROL — a non-admin colleague calls release_group.
-- release_group should no-op; A's lock must survive.
-- ---------------------------------------------------------------------
\echo '=== R1: non-admin colleague (caller D) releases ==='

set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"11111111-1111-1111-1111-111111111111","access_code_id":"44444444-0000-0000-0000-00000000000a","staff_member_id":"33333333-0000-0000-0000-00000000000d"}';
set role authenticated;

do $$ begin perform public.release_group('aaaaaaaa-0000-0000-0000-000000000001'::uuid); end $$;

reset role;
reset request.jwt.claims;

do $$ begin perform repro.record(
  'R1', 'non-admin colleague releases -> caller A keeps the lock',
  'caller-A',
  repro.lock_holder('aaaaaaaa-0000-0000-0000-000000000001')
); end $$;

-- ---------------------------------------------------------------------
-- R2 THE REGRESSION — an admin session that holds nothing calls release.
-- This is what the old `or app.is_admin()` branch let through. Any call
-- site that fires release_group without first checking it holds the lock
-- reintroduces the bug for admins only, which is why the invariant is
-- pinned in the database and not just at the call site.
-- ---------------------------------------------------------------------
\echo '=== R2: admin who holds nothing calls release_group ==='

set request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
set role authenticated;

-- C1 false-green guard: prove this session really is an admin. If
-- is_admin() were false, R2 would pass for entirely the wrong reason.
do $$ begin perform repro.record(
  'C1', 'CONTROL: the R2 session really is an admin',
  'true',
  app.is_admin()::text
); end $$;

do $$ begin perform public.release_group('aaaaaaaa-0000-0000-0000-000000000001'::uuid); end $$;

reset role;
reset request.jwt.claims;

do $$ begin perform repro.record(
  'R2', 'ADMIN releases -> caller A keeps the lock',
  'caller-A',
  repro.lock_holder('aaaaaaaa-0000-0000-0000-000000000001')
); end $$;

-- ---------------------------------------------------------------------
-- R4 — the legitimate admin case, which any fix must NOT break.
-- An admin who genuinely HOLDS the lock must still be able to drop it.
-- This is the regression risk of removing the `or app.is_admin()` branch:
-- if a fix over-restricts, R4 goes red while R2 goes green.
-- ---------------------------------------------------------------------
\echo '=== R4: admin releases a lock the admin DOES hold ==='

-- Reset lock state so R4 is independent of whatever R2 left behind.
update public.guest_groups
   set locked_by = null, locked_by_staff = null, locked_until = null
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

set request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000a1"}';
set role authenticated;

do $$ begin perform public.claim_group('aaaaaaaa-0000-0000-0000-000000000001'::uuid, 15); end $$;

do $$ begin perform repro.record(
  'C4', 'CONTROL: the admin now holds the lock themselves',
  'auth-user',
  repro.lock_holder('aaaaaaaa-0000-0000-0000-000000000001')
); end $$;

do $$ begin perform public.release_group('aaaaaaaa-0000-0000-0000-000000000001'::uuid); end $$;

reset role;
reset request.jwt.claims;

do $$ begin perform repro.record(
  'R4', 'admin releases their OWN lock -> lock is dropped',
  'unlocked',
  repro.lock_holder('aaaaaaaa-0000-0000-0000-000000000001')
); end $$;

-- ---------------------------------------------------------------------
-- MINIMISATION NOTE — why R1 is the control, and why there is no third probe.
--
-- The obvious extra probe ("a non-admin GoTrue user releases") is
-- UNCONSTRUCTIBLE against this schema. The code-auth migrations redefined
-- app.is_staff() to:
--     app.is_admin() OR (jwt_event_id = p_event_id AND jwt_app_role='team'
--                        AND code_is_live())
-- event_members / role_in_event are no longer consulted for staff-ness. So
-- for a GoTrue session app.is_admin() is the ONLY route to is_staff(), and
-- a demoted admin fails release_group at the `and app.is_staff(...)` clause
-- instead of at the admin branch — it would go green for the wrong reason.
-- (Measured: role_in_event='event_team' yet is_staff() returns NULL.)
--
-- R1 is therefore the correct single-variable control: R1 and R2 are BOTH
-- staff and BOTH hold no lock. The only difference between them is
-- is_admin(). R1 green + R2 red isolates the cause to `or app.is_admin()`.
-- ---------------------------------------------------------------------

-- ---------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------
\echo ''
\echo '=================== RESULTS ==================='
select id, result, expected, actual, name from repro.results order by seq;

\echo ''
select count(*) filter (where result = 'PASS') as passed,
       count(*) filter (where result = 'FAIL') as failed
  from repro.results;

-- Exit non-zero when anything failed, so the shell can gate on it.
do $$
declare n int;
begin
  select count(*) into n from repro.results where result = 'FAIL';
  if n > 0 then
    raise exception 'L4 FAILED: % assertion(s) failed', n;
  end if;
end $$;
