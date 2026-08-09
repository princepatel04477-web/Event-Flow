-- =====================================================================
-- 1900 CODE-BASED AUTH — TABLES + CLAIM HELPERS
--
-- Replaces email/password for team and client access with per-event
-- access codes. Admin stays email/password + optional device binding.
--
-- The security model changes from "auth.uid() → profiles/event_members"
-- to "JWT claim → event_id + app_role". Everything below is additive;
-- the RLS rewrite that consumes it is migration 1901.
--
-- PRINCIPLES (do not weaken in later edits):
--   * Codes are secrets: stored as SHA-256 hash + prefix + last_four
--     only. No plaintext anywhere. Reveal is logged.
--   * The JWT `role` claim must be an existing Postgres role, so
--     team/client live in a CUSTOM claim `app_role` ('team'|'client'),
--     and the minted JWT always carries `role = 'authenticated'`.
--   * Code-auth sessions have NO auth.uid(). Identity for writes comes
--     from the staff_members selection, never from a JWT sub.
--   * Rate limiting is a table, not app logic: every attempt logs a row;
--     the Edge Function enforces windows by counting rows.
--
-- IDEMPOTENT: create table if not exists, create or replace function,
-- DO-block grants.
-- =====================================================================

-- ---------------------------------------------------------------------
-- ACCESS CODES — one row per role per event (team + client).
-- ---------------------------------------------------------------------
create table if not exists public.event_access_codes (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  role          text not null check (role in ('team', 'client')),
  code_hash     text not null,           -- sha256 of the full code. Never plaintext.
  code_prefix   text not null,           -- e.g. 'E' or 'C' — for admin list display.
  last_four     text not null,           -- last 4 of the code — admin identification.
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  rotated_at    timestamptz,             -- set on the OLD row when rotated.
  revoked_at    timestamptz,             -- set when explicitly revoked.
  unique (event_id, role)
);

create index if not exists event_access_codes_hash_idx
  on public.event_access_codes (code_hash);
create index if not exists event_access_codes_event_idx
  on public.event_access_codes (event_id);

comment on table public.event_access_codes is
  'Per-event access codes. code_hash is sha256 of the code; the plaintext '
  'exists only once at generation and on explicit admin Reveal (logged). '
  'Codes are never shown in team/client UI, exports, or logs.';

-- ---------------------------------------------------------------------
-- STAFF MEMBERS — the named staff list per event. Team sessions pick
-- one; every write records it. Unattributed writes are blocked.
--
-- NEVER hard-deleted: a deleted row would orphan attribution on records
-- that can never be corrected (delivery_proofs is insert-only). Soft-
-- delete via is_active = false only; the trigger below blocks DELETE.
-- ---------------------------------------------------------------------
create table if not exists public.staff_members (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  full_name     text not null,
  is_active     boolean not null default true,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Case-insensitive uniqueness per event (a unique INDEX, not a table
-- constraint — a UNIQUE constraint cannot contain lower(full_name)).
create unique index if not exists staff_members_event_name_uq
  on public.staff_members (event_id, lower(full_name));

select app.attach_standard_triggers('public.staff_members');

-- Block hard delete: attribution rows may reference this staff member
-- forever (delivery_proofs is immutable), so the row must survive.
create or replace function app.block_staff_member_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'staff_members is soft-delete only; set is_active = false instead. Deleting would orphan attribution that can never be corrected.'
    using errcode = '42501';
end;
$$;

drop trigger if exists staff_members_no_delete on public.staff_members;
create trigger staff_members_no_delete
  before delete on public.staff_members
  for each row execute function app.block_staff_member_delete();

-- ---------------------------------------------------------------------
-- CODE REVEAL LOG — every time an admin reveals a code.
-- ---------------------------------------------------------------------
create table if not exists public.code_reveal_log (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  access_code_id uuid not null references public.event_access_codes (id) on delete cascade,
  revealed_by   uuid references auth.users (id),
  revealed_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- LOGIN ATTEMPT LOG — every code entry, success or failure. The rate
-- limiter reads this; the admin screen reads it to spot an attack.
-- IP is recorded for the per-IP window. The attempted PREFIX (E or C)
-- is logged, never the full code.
-- ---------------------------------------------------------------------
create table if not exists public.login_attempt_log (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid,                    -- null until the code resolves to an event.
  device_id     text not null,           -- the client's stored device uuid.
  ip_address    text not null,
  attempted_prefix text not null,        -- 'E' | 'C' — never the full code.
  succeeded     boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists login_attempt_log_device_idx
  on public.login_attempt_log (device_id, created_at desc);
create index if not exists login_attempt_log_ip_idx
  on public.login_attempt_log (ip_address, created_at desc);

-- ---------------------------------------------------------------------
-- ADMIN DEVICES — device binding for admin convenience. This is NOT
-- the security boundary (RLS is); a bound device token grants only
-- what the admin role already allows in Postgres.
-- ---------------------------------------------------------------------
create table if not exists public.admin_devices (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users (id) on delete cascade,
  device_id     text not null,           -- the device's stored uuid.
  device_label  text not null,           -- e.g. "Prince Pixel".
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  unique (device_id)
);

create index if not exists admin_devices_user_idx
  on public.admin_devices (admin_user_id);

-- ---------------------------------------------------------------------
-- DELIVERY_PROOFS.captured_by_staff — code-auth attribution.
--
-- delivery_proofs is INSERT-ONLY (block_mutation trigger). 126 rows
-- already exist with captured_by = auth.uid() and cannot be repointed.
-- This NULLABLE column sits beside captured_by: NEW rows (code-auth)
-- set captured_by_staff = staff_members.id and leave captured_by NULL;
-- OLD rows keep captured_by. The export resolves whichever is present.
-- No backfill — the trigger would reject an UPDATE.
-- ---------------------------------------------------------------------
alter table public.delivery_proofs
  add column if not exists captured_by_staff uuid references public.staff_members (id);

comment on column public.delivery_proofs.captured_by_staff is
  'The staff_members.id who captured this proof (code-auth sessions have '
  'no auth uid). Mutually exclusive with captured_by: new rows set this, '
  'legacy rows keep captured_by. Insert-only — never backfilled.';

-- ---------------------------------------------------------------------
-- CLAIM-BASED ACCESS HELPERS
--
-- The JWT minted by verify-access-code carries:
--   role          = 'authenticated'   (must be a real Postgres role)
--   app_role      = 'team' | 'client' (custom claim)
--   event_id      = uuid              (custom claim)
--   access_code_id= uuid              (custom claim)
--
-- app.is_admin() cannot use auth.uid() anymore for code-auth sessions —
-- admin is email/password, so it still resolves a real auth.users row.
-- The helpers read auth.jwt() and NEVER recurse into RLS (security
-- definer + search_path ''). They are grants to authenticated only.
-- ---------------------------------------------------------------------

-- The current request's event scope from the JWT, or null.
create or replace function app.jwt_event_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'event_id', '')::uuid;
$$;

-- The current request's app role from the JWT, or null.
create or replace function app.jwt_app_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select auth.jwt() ->> 'app_role';
$$;

-- The access_code_id that minted this JWT, or null.
create or replace function app.jwt_access_code_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'access_code_id', '')::uuid;
$$;

-- Admin: still a real auth.users row with global_role admin. Unchanged
-- from 0100 except it now short-circuits for a claim-based (no-uid)
-- session, which is never admin.
create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when auth.uid() is null then false
         else exists (
           select 1 from public.profiles p
           where p.id = auth.uid()
             and p.global_role = 'admin'
             and p.is_active
         )
    end;
$$;

-- Team: the JWT claims event_id + app_role = 'team', both present.
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
      );
$$;

-- Member: admin, or the JWT is scoped to this event (team or client).
create or replace function app.is_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or app.jwt_event_id() = p_event_id;
$$;

-- The current session's selected staff member, or null. Set by the
-- client after the "Who are you?" picker and stored in the JWT.
create or replace function app.jwt_staff_member_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(auth.jwt() ->> 'staff_member_id', '')::uuid;
$$;

-- True when the session has a selected staff member for THIS event.
-- Write actions gate on this so an unattributed proof cannot happen.
create or replace function app.has_staff_identity(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (app.jwt_event_id() = p_event_id)
    and (app.jwt_staff_member_id() is not null)
    and exists (
      select 1 from public.staff_members sm
      where sm.id = app.jwt_staff_member_id()
        and sm.event_id = p_event_id
        and sm.is_active
    );
$$;

grant execute on function app.jwt_event_id(), app.jwt_app_role(),
  app.jwt_access_code_id(), app.jwt_staff_member_id(),
  app.has_staff_identity(uuid) to authenticated;
