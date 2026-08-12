-- =====================================================================
-- L3 — ACCESS CODE ISSUANCE
-- =====================================================================
-- SCRATCH DATABASE ONLY. Seeds its own event and codes.
--
--   psql "$SCRATCH_URL" -v ON_ERROR_STOP=off -f tests/l3_access_codes.sql
--
-- ---------------------------------------------------------------------
-- WHY THIS FILE EXISTS
--
-- L1 asserts, thoroughly, that team and client sessions CANNOT read
-- event_access_codes. It never asserted that an admin CAN. That asymmetry is
-- exactly how the issuance gap reached production: every test was green while
-- there was no way for a human to obtain a code at all. A suite that only
-- tests denials cannot tell "correctly locked down" from "broken for
-- everyone".
--
-- So every negative here is paired with a positive control. If a control
-- fails, the denials around it mean nothing.
-- =====================================================================

\set ON_ERROR_STOP off
\pset pager off
\timing off

drop schema if exists l3 cascade;
create schema l3;

create table l3.results (
  id text, name text, expected text, actual text, result text, severity text
);

create or replace function l3.record(
  p_id text, p_name text, p_expected text, p_actual text,
  p_severity text default 'BLOCKS EVENT'
) returns void
language sql security definer
set search_path = ''
as $$
  insert into l3.results (id, name, expected, actual, result, severity)
  values (p_id, p_name, p_expected, p_actual,
          case when p_expected = p_actual then 'PASS' else 'FAIL' end,
          p_severity);
$$;
grant usage on schema l3 to public;
grant execute on function l3.record(text,text,text,text,text) to public;

create or replace function l3.count_sql(p_sql text)
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
grant execute on function l3.count_sql(text) to public;

-- ---------------------------------------------------------------------
-- SEED
-- ---------------------------------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'l3admin@x.com')
on conflict do nothing;

insert into public.profiles (id, global_role)
values ('00000000-0000-0000-0000-0000000000c1', 'admin')
on conflict (id) do update set global_role = 'admin';

insert into public.events (id, code, name, created_by) values
  ('33333333-3333-3333-3333-333333333331', 'L3EVENT', 'L3 Event',
   '00000000-0000-0000-0000-0000000000c1')
on conflict do nothing;

insert into public.event_access_codes
  (id, event_id, role, code_hash, code_prefix, last_four) values
  ('44444444-3333-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333331',
   'team', repeat('a', 64), 'E', 'aaaa')
on conflict do nothing;

-- ---------------------------------------------------------------------
-- L3.1 — POSITIVE CONTROL. An admin must be able to READ the code list.
-- Without this the admin screen shows "no codes issued" for every event and
-- nobody can tell that from a genuinely empty event.
-- ---------------------------------------------------------------------
\echo '=== L3.1 admin CAN read event_access_codes ==='
set local role authenticated;
set request.jwt.claims = '{"role":"authenticated","sub":"00000000-0000-0000-0000-0000000000c1"}';

select l3.record(
  'L3.1-admin-read-codes',
  'CONTROL: an admin reads the event''s access code rows',
  '1',
  l3.count_sql('select count(*) from public.event_access_codes where event_id = ''33333333-3333-3333-3333-333333333331''')
);

-- ---------------------------------------------------------------------
-- L3.2 — POSITIVE CONTROL. An admin must be able to ISSUE a code.
-- This is the assertion whose absence let the issuance gap ship.
-- ---------------------------------------------------------------------
\echo '=== L3.2 admin CAN issue a code ==='
do $$
declare v_new uuid; v_state text;
begin
  v_new := public.issue_access_code(
    '33333333-3333-3333-3333-333333333331', 'team', repeat('b', 64), 'bbbb');
  perform l3.record('L3.2-admin-issue', 'CONTROL: an admin issues a new code',
                    'issued', case when v_new is null then 'null' else 'issued' end);
exception when others then
  perform l3.record('L3.2-admin-issue', 'CONTROL: an admin issues a new code',
                    'issued', 'error:' || sqlstate);
end $$;

-- The old row must be RETIRED, not deleted — code_is_live() reads it to
-- recognise and refuse sessions minted from it.
select l3.record(
  'L3.2-old-row-retired',
  'The previous row is kept and stamped rotated_at',
  '1',
  l3.count_sql('select count(*) from public.event_access_codes
                 where id = ''44444444-3333-0000-0000-00000000000a'' and rotated_at is not null')
);

select l3.record(
  'L3.2-one-live-per-role',
  'Exactly one live team code remains',
  '1',
  l3.count_sql('select count(*) from public.event_access_codes
                 where event_id = ''33333333-3333-3333-3333-333333333331''
                   and role = ''team'' and rotated_at is null and revoked_at is null')
);

select l3.record(
  'L3.2-reveal-logged',
  'Issuing wrote a code_reveal_log row',
  '1',
  l3.count_sql('select count(*) from public.code_reveal_log
                 where event_id = ''33333333-3333-3333-3333-333333333331''')
);

reset request.jwt.claims;
reset role;

-- ---------------------------------------------------------------------
-- L3.3 — the denials, which only mean something because L3.1/L3.2 pass.
-- ---------------------------------------------------------------------
\echo '=== L3.3 team cannot read or issue ==='
set local role authenticated;
set request.jwt.claims = '{"role":"authenticated","app_role":"team","event_id":"33333333-3333-3333-3333-333333333331","access_code_id":"44444444-3333-0000-0000-00000000000a"}';

select l3.record(
  'L3.3-team-read-codes',
  'A team session reads zero access-code rows',
  '0',
  l3.count_sql('select count(*) from public.event_access_codes')
);

do $$
declare v_state text := 'ALLOWED';
begin
  perform public.issue_access_code(
    '33333333-3333-3333-3333-333333333331', 'team', repeat('c', 64), 'cccc');
exception when others then v_state := 'denied';
end $$;

-- The row must not exist. Checked as the SUPERUSER, not as the team session:
-- a team session reads zero rows either way (RLS), so asking it whether its
-- own forbidden insert landed would pass for the wrong reason.
reset request.jwt.claims;
reset role;

select l3.record(
  'L3.3-team-issue-denied',
  'A team session''s issue attempt created no row',
  '0',
  l3.count_sql('select count(*) from public.event_access_codes
                 where code_hash = ' || quote_literal(repeat('c', 64)))
);

reset request.jwt.claims;
reset role;

\echo '=== L3 SCOREBOARD ==='
select id, result, name, expected, actual from l3.results order by id;
select
  count(*) filter (where result = 'PASS') as passed,
  count(*) filter (where result = 'FAIL') as failed,
  count(*)                                as total
from l3.results;
