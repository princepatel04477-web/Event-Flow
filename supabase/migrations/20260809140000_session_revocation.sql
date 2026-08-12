-- =====================================================================
-- Revocation and rotation must end live sessions
-- =====================================================================
-- Confirmed against the running project on 2026-08-09 (TEST-LOG.md L5):
-- a team session minted from an E-code kept BOTH read and write access
-- to guest data after the code was revoked. New logins were correctly
-- refused (401), but the already-issued 30-day token sailed on.
--
-- Lost phone at the venue is the exact scenario revocation exists for.
--
-- Cause: nothing on the request path ever looked at the code row.
-- app.jwt_*() read claims straight out of the JWT, and
-- verifyCodeAuthToken checks signature + expiry only. revoked_at was
-- consulted at mint time, inside the Edge Function, and nowhere else.
--
-- Fix, in two parts:
--
--   1. app.code_is_live() — one indexed lookup on a tiny table, folded
--      into is_staff/is_member so EVERY policy inherits it. That closes
--      PostgREST too, which is how the probe got in: it never touches
--      Next.js, so an app-layer check alone would not have helped.
--
--   2. rotate_access_code actually rotates. It used to stamp
--      rotated_at = now() and then immediately set it back to null on
--      the SAME row, so rotation marked nothing at all. It now stamps
--      the old row and inserts a new one, matching its own header
--      comment — which needs the uniqueness rule to apply only to LIVE
--      codes, hence the partial index below.
--
-- COST: code_is_live() is `stable`, so it is evaluated once per query
-- rather than per row, and hits event_access_codes by primary key.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Uniqueness applies to LIVE codes only
-- ---------------------------------------------------------------------
-- The old `unique (event_id, role)` made real rotation impossible: you
-- could not keep the retired row and insert its replacement. Retired
-- rows must persist so sessions minted from them can be recognised and
-- refused.
alter table public.event_access_codes
  drop constraint if exists event_access_codes_event_id_role_key;

drop index if exists event_access_codes_one_live_per_role;
create unique index event_access_codes_one_live_per_role
  on public.event_access_codes (event_id, role)
  where rotated_at is null and revoked_at is null;

-- ---------------------------------------------------------------------
-- 2. Is the code behind this session still live?
-- ---------------------------------------------------------------------
-- Returns true for admin/auth sessions, which carry no access_code_id
-- claim and are not code-auth at all — without that branch every admin
-- policy would start returning false.
create or replace function app.code_is_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when app.jwt_access_code_id() is null then true   -- not a code session
    else exists (
      select 1
      from public.event_access_codes c
      where c.id = app.jwt_access_code_id()
        and c.revoked_at is null
        and c.rotated_at is null
    )
  end;
$$;

grant execute on function app.code_is_live() to authenticated, anon;

comment on function app.code_is_live() is
  'False once the access code that minted this session has been revoked '
  'or rotated. Folded into is_staff/is_member so revocation takes effect '
  'on the next request instead of at token expiry.';

-- PostgREST exposes only `public` (config.toml: schemas = ["public",
-- "graphql_public"]), so the app cannot call app.code_is_live() over
-- HTTP. This wrapper is how src/lib/auth/server.ts asks the question,
-- passing the session's own JWT so the claim is read from the token.
-- SECURITY DEFINER because event_access_codes is unreadable under RLS
-- for every session type — L1.3-read-codes proves a team session gets
-- nothing — so a direct select would fail closed for everyone.
create or replace function public.session_code_live()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.code_is_live();
$$;

grant execute on function public.session_code_live() to authenticated, anon;

comment on function public.session_code_live() is
  'App-facing wrapper over app.code_is_live(). Reads access_code_id from '
  'the caller JWT; returns false once that code is revoked or rotated.';

-- ---------------------------------------------------------------------
-- 3. Fold it into the two gates every policy already uses
-- ---------------------------------------------------------------------
-- Bodies are otherwise unchanged from 20260807000500.
create or replace function app.is_staff(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or (
        app.jwt_event_id() = p_event_id
        and app.jwt_app_role() = 'team'
        and app.code_is_live()
      );
$$;

create or replace function app.is_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or (
        app.jwt_event_id() = p_event_id
        and app.code_is_live()
      );
$$;

-- ---------------------------------------------------------------------
-- 4. Make rotation actually rotate
-- ---------------------------------------------------------------------
-- Old body stamped rotated_at then nulled it on the same row, so the old
-- code was never marked and sessions from it stayed valid. Now the old
-- row is retired and a new row is inserted, so code_is_live() refuses
-- every session minted from the retired one.
-- Returns the new row id now, so the return type changes from void —
-- which create-or-replace cannot do. No application code calls this yet
-- (grep of src/ and supabase/functions/ finds no callers), so dropping
-- is safe; admin code-management UI is still to be built.
drop function if exists app.rotate_access_code(uuid, text, text);

create function app.rotate_access_code(
  p_code_id uuid,
  p_new_hash text,
  p_new_last_four text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event uuid;
  v_role  text;
  v_prefix text;
  v_new   uuid;
begin
  if not app.is_admin() then
    raise exception 'Only an admin may rotate a code.' using errcode = '42501';
  end if;

  select event_id, role, code_prefix
    into v_event, v_role, v_prefix
    from public.event_access_codes
   where id = p_code_id;

  if v_event is null then
    raise exception 'Access code % not found.', p_code_id using errcode = 'P0002';
  end if;

  -- Retire the old row. It is KEPT so code_is_live() can recognise and
  -- refuse sessions that were minted from it.
  update public.event_access_codes
     set rotated_at = now()
   where id = p_code_id
     and rotated_at is null
     and revoked_at is null;

  insert into public.event_access_codes
    (event_id, role, code_hash, code_prefix, last_four, created_by)
  values
    (v_event, v_role, p_new_hash, v_prefix, p_new_last_four, auth.uid())
  returning id into v_new;

  return v_new;
end;
$$;

grant execute on function app.rotate_access_code(uuid, text, text) to authenticated;

comment on function app.rotate_access_code(uuid, text, text) is
  'Retires the old code row (rotated_at) and inserts its replacement, '
  'returning the new row id. Sessions minted from the retired row stop '
  'working on their next request via app.code_is_live().';
