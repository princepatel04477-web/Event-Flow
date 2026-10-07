-- EventFlow — the 7 migrations created on 2026-09-25, in order.
-- Paste this whole file into Supabase → SQL Editor for project xktxnkuzplhzxkevwrcj and Run.
-- Additive and idempotent; no data is dropped.


-- ============================================================
-- [1/7] 20260925120000_rooms_room_type_bulk_create.sql
-- ============================================================
-- =====================================================================
-- T4 - BULK ROOM CREATION
--
-- Two things:
--   1. rooms.room_type stops being free text. It is back-filled to
--      'standard' and constrained to the fixed vocabulary the UI offers
--      (suite, standard, deluxe, king, queen).
--   2. create_rooms_bulk() creates a contiguous run of numbered rooms in
--      one transaction, skipping numbers that already exist.
--
-- SECURITY INVOKER is deliberate: a DEFINER bulk insert would bypass the
-- rooms RLS insert policy and let one event write rooms into another.
--
-- rooms stays unique (hotel_id, room_number) - NOT (event_id, ...).
-- hotel_id is already event-fenced by the composite FK to
-- hotels (id, event_id), so that constraint is the one the "skip existing
-- numbers" check must match, and ON CONFLICT targets it exactly.
-- =====================================================================

-- 1. rooms.room_type becomes a constrained attribute ---------------------

-- The column already exists (plain text, from the 0300 baseline). NOT NULL is
-- deliberately NOT imposed: live call sites explicitly write a null room_type
-- for a room created without one, and the check below lets NULL through.
-- The default and the back-fill mean a type is present in practice; the UI
-- falls back to 'Standard' for any legacy NULL.
update public.rooms set room_type = 'standard' where room_type is null;

-- Fold case and whitespace, then fold anything outside the fixed vocabulary to
-- 'standard'. This is NOT hypothetical: two selects in the app offered 'Twin'
-- (no King, no Queen) and the importer's sample sheet ships a 'Twin' row, so a
-- live table can hold values the CHECK below would reject. Without this the
-- constraint would fail to apply on real data.
update public.rooms set room_type = lower(btrim(room_type)) where room_type is not null;
update public.rooms set room_type = 'standard'
 where room_type not in ('suite', 'standard', 'deluxe', 'king', 'queen');

alter table public.rooms alter column room_type set default 'standard';

alter table public.rooms drop constraint if exists rooms_room_type_check;
alter table public.rooms add constraint rooms_room_type_check
  check (room_type in ('suite', 'standard', 'deluxe', 'king', 'queen'));

create index if not exists rooms_event_room_type_idx
  on public.rooms (event_id, room_type);

comment on column public.rooms.room_type is
  'Fixed vocabulary: suite | standard | deluxe | king | queen. Defaults to standard.';

-- Trigger coverage is deliberately NOT re-asserted here. public.rooms is
-- already audit-covered by the 0300 baseline (which calls
-- app.attach_standard_triggers('public.rooms')), and that helper issues a bare
-- CREATE TRIGGER - no OR REPLACE, no DROP IF EXISTS - so it is a first-attach
-- helper and is NOT idempotent. Calling it again would abort this migration
-- with `trigger "rooms_audit" for relation "rooms" already exists` (42710) on
-- both the live database and a replayed clone. 0300 already attached
-- rooms_audit + rooms_touch and they must stay; nothing to do.
-- 2. Bulk create --------------------------------------------------------

create or replace function public.create_rooms_bulk(
  p_event_id     uuid,
  p_hotel_id     uuid,
  p_room_type    text,
  p_qty          integer,
  p_start_number integer,
  p_prefix       text    default '',
  p_capacity     integer default 2,
  p_max_capacity integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidates text[];
  v_created    text[];
  v_skipped    text[];
  v_capacity   integer := coalesce(p_capacity, 2);
  v_max        integer := coalesce(p_max_capacity, coalesce(p_capacity, 2) + 1);
begin
  -- app.is_staff() is `is_admin() or (jwt_event_id() = p_event_id and ...)`, so
  -- a caller with no event claim evaluates it to NULL, not false. `if not NULL`
  -- is NULL and plpgsql does not enter the branch, which would silently skip
  -- this guard; test `is not true` so NULL is treated as not-staff.
  if app.is_staff(p_event_id) is not true then
    raise exception 'Not permitted for event %.', p_event_id using errcode = '42501';
  end if;

  if p_qty is null or p_qty < 1 then
    raise exception 'Quantity must be at least 1.' using errcode = '22023';
  end if;
  if p_qty > 500 then
    raise exception 'Cannot create more than 500 rooms at once (asked for %).', p_qty
      using errcode = '22023';
  end if;

  if p_start_number is null or p_start_number < 0 then
    raise exception 'Starting room number must be zero or greater.' using errcode = '22023';
  end if;

  if p_room_type is null
     or p_room_type not in ('suite', 'standard', 'deluxe', 'king', 'queen') then
    raise exception 'Unknown room type "%".', p_room_type using errcode = '22023';
  end if;

  if v_capacity < 1 then
    raise exception 'Capacity must be at least 1.' using errcode = '22023';
  end if;

  if v_max < v_capacity then
    raise exception 'Max capacity (%) cannot be below capacity (%).', v_max, v_capacity
      using errcode = '22023';
  end if;

  -- The hotel must belong to this event. Redundant with RLS on purpose: it
  -- turns a silently-empty insert into a named error.
  if not exists (
    select 1 from public.hotels h
     where h.id = p_hotel_id
       and h.event_id = p_event_id
  ) then
    raise exception 'Hotel % does not belong to event %.', p_hotel_id, p_event_id
      using errcode = '23503';
  end if;
  v_candidates := array(
    select coalesce(p_prefix, '') || (p_start_number + gs - 1)::text
      from generate_series(1, p_qty) gs
  );

  -- ON CONFLICT matches unique (hotel_id, room_number) exactly: numbers that
  -- already exist are skipped, and a concurrent insert cannot raise 23505.
  with ins as (
    insert into public.rooms (
      event_id, hotel_id, room_number, room_type, capacity, max_capacity
    )
    select p_event_id, p_hotel_id, c, p_room_type, v_capacity, v_max
      from unnest(v_candidates) c
    on conflict (hotel_id, room_number) do nothing
    returning room_number
  )
  select coalesce(array_agg(room_number), '{}'::text[])
    into v_created
    from ins;

  select coalesce(array_agg(c order by c), '{}'::text[])
    into v_skipped
    from unnest(v_candidates) c
   where c <> all (coalesce(v_created, '{}'::text[]));

  return jsonb_build_object(
    'created', coalesce(array_length(v_created, 1), 0),
    'skipped', to_jsonb(coalesce(v_skipped, '{}'::text[]))
  );
end;
$$;

revoke all on function public.create_rooms_bulk(
  uuid, uuid, text, integer, integer, text, integer, integer
) from public;

grant execute on function public.create_rooms_bulk(
  uuid, uuid, text, integer, integer, text, integer, integer
) to authenticated;

-- ============================================================
-- [2/7] 20260925130000_event_rsvp_buckets.sql
-- ============================================================
-- =====================================================================
-- A7 - RSVP BREAKDOWN BY CONFIRMATION BUCKET
--
-- The admin dashboard gained five confirmation tabs (Confirmed, Not coming,
-- Maybe, No answer, Not called), each showing PAX + family count + the list.
-- One row per family, with the PAX the rest of the app already uses
-- (confirmed_pax, falling back to expected_pax) and the bucket the tab reads.
--
-- SECURITY. `security_invoker = true`, exactly like `v_event_board`
-- (20260809120000): this runs as the CALLER, so `guest_groups` RLS applies and
-- a client session (is_member, not is_staff) sees nothing. No policy is
-- touched; this is additive.
--
-- BUCKETS are exhaustive over app.rsvp_status so no family can vanish from
-- every tab:
--   confirmed            -> 'confirmed'
--   declined             -> 'not_coming'
--   tentative            -> 'maybe'
--   unreachable,attempted-> 'no_answer'
--   everything else      -> 'not_called'  (not_started, null, and callback:
--                           a family that asked to be called back has still not
--                           given an answer, so it is outstanding work)
-- =====================================================================

create or replace view public.v_event_rsvp_buckets
with (security_invoker = true) as
select
  g.event_id,
  g.id as group_id,
  coalesce(nullif(btrim(g.head_name), ''), 'Unnamed family') as head_name,
  coalesce(g.confirmed_pax, g.expected_pax, 0) as pax,
  case
    when g.rsvp_status = 'confirmed' then 'confirmed'
    when g.rsvp_status = 'declined' then 'not_coming'
    when g.rsvp_status = 'tentative' then 'maybe'
    when g.rsvp_status in ('unreachable', 'attempted') then 'no_answer'
    else 'not_called'
  end as bucket
from public.guest_groups g;

grant select on public.v_event_rsvp_buckets to authenticated;


-- ============================================================
-- [3/7] 20260925140000_create_event_with_defaults.sql
-- ============================================================
-- =====================================================================
-- A7 - CREATE EVENT IN ONE ROUND TRIP
--
-- Creating an event used to be two sequential PostgREST inserts (events,
-- then the two event_access_codes) after two dynamic module imports and a
-- pair of hash computations â€” each insert a full ~150ms hop from India to the
-- Supabase region. This folds both inserts into one transaction so the create
-- costs one hop, not two.
--
-- The codes are still generated and hashed in the app (`lib/auth/codes`), so
-- their plaintext never reaches the database; the RPC receives only hashes.
--
-- SECURITY INVOKER, deliberately: `events` is `insert with check
-- (app.is_admin())` and `event_access_codes` is likewise admin-gated, so
-- running as the caller means those policies are the fence. A DEFINER function
-- here would hand any authenticated user a way to mint events and codes.
--
-- The `auth.uid() is null` guard turns a code-auth session trying to create an
-- event into a named 42501 rather than a bare not-null violation deeper down.
-- =====================================================================

create or replace function public.create_event_with_defaults(
  p_name            text,
  p_code            text,
  p_bride_name      text,
  p_groom_name      text,
  p_starts_on       date,
  p_ends_on         date,
  p_team_hash       text,
  p_team_last_four  text,
  p_client_hash     text,
  p_client_last_four text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id   uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in again to create an event.' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Give the event a name.' using errcode = '22023';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Give the event a short code.' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'Pick the first day of the event.' using errcode = '22023';
  end if;

  insert into public.events (
    name, code, bride_name, groom_name, starts_on, ends_on, created_by
  )
  values (
    btrim(p_name),
    btrim(p_code),
    nullif(btrim(coalesce(p_bride_name, '')), ''),
    nullif(btrim(coalesce(p_groom_name, '')), ''),
    p_starts_on,
    p_ends_on,
    auth.uid()
  )
  returning id, code into v_id, v_code;

  insert into public.event_access_codes (
    event_id, role, code_hash, code_prefix, last_four, created_by
  )
  values
    (v_id, 'team',   p_team_hash,   'E', p_team_last_four,   auth.uid()),
    (v_id, 'client', p_client_hash, 'C', p_client_last_four, auth.uid());

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

revoke all on function public.create_event_with_defaults(
  text, text, text, text, date, date, text, text, text, text
) from public;

grant execute on function public.create_event_with_defaults(
  text, text, text, text, date, date, text, text, text, text
) to authenticated;


-- ============================================================
-- [4/7] 20260925150000_staff_department_rsvp.sql
-- ============================================================
-- =====================================================================
-- A8 - THE RSVP / CALLS DEPARTMENT
--
-- Adds a sixth value to `app.staff_department` so a calling team can be given
-- its own role: sections dashboard + rsvp, landing on the call queue.
--
-- `add value if not exists` is idempotent and safe here: PostgreSQL 12+ allows
-- ALTER TYPE ... ADD VALUE inside a transaction as long as the new value is not
-- USED in the same transaction, and this migration only declares it. The
-- app-layer union (src/lib/departments.ts) is updated in the same commit.
-- =====================================================================

alter type app.staff_department add value if not exists 'rsvp';

comment on type app.staff_department is
  'Field-team department. rsvp = "RSVP / Calls": dashboard + rsvp sections, home = the call queue.';


-- ============================================================
-- [5/7] 20260925160000_event_section_locks.sql
-- ============================================================
-- =====================================================================
-- A8 - PER-EVENT SECTION LOCKS
--
-- An admin can lock a section for an event (rsvp, hospitality, hamper,
-- logistics). Locked means READ-ONLY FOR STAFF, and it is enforced in the
-- DATABASE, not just hidden in the UI: a staff write to a locked section is
-- refused by a BEFORE trigger, so it fails even through PostgREST or a raw
-- session.
--
-- WHY A TRIGGER AND NOT ONLY RLS. The tables in these sections (guest_groups,
-- rooms, deliverables, travel_legs, ...) already carry the shared staff
-- policies from `app.apply_staff_policies`. Rewriting four policies per table
-- to ALSO test a lock would touch ~11 tables' policy sets and risk opening a
-- hole on one of them. A single BEFORE row trigger per table is additive: it
-- can only ever REFUSE a write, never widen one, and it covers INSERT, UPDATE
-- and DELETE uniformly.
--
-- ADMINS BYPASS THE LOCK. `app.is_admin()` is checked first, so the admin who
-- set the lock keeps working; a lock is a fence around the field team, not the
-- office.
--
-- The lock table itself is admin-write / staff-read (staff must read it to show
-- the "Locked by admin" banner), enforced by RLS.
-- =====================================================================

-- 1. The lock table ------------------------------------------------------

create table if not exists public.event_section_locks (
  event_id  uuid not null references public.events (id) on delete cascade,
  section   text not null check (section in ('rsvp', 'hospitality', 'hamper', 'logistics')),
  locked_by uuid,
  locked_at timestamptz not null default now(),
  primary key (event_id, section)
);

comment on table public.event_section_locks is
  'Per-event, per-section write locks. Presence of a row = locked for staff; admins bypass. Enforced by app.enforce_section_lock() triggers.';

alter table public.event_section_locks enable row level security;

drop policy if exists event_section_locks_sel on public.event_section_locks;
create policy event_section_locks_sel on public.event_section_locks
  for select to authenticated using (app.is_staff(event_id));

drop policy if exists event_section_locks_ins on public.event_section_locks;
create policy event_section_locks_ins on public.event_section_locks
  for insert to authenticated with check (app.is_admin());

drop policy if exists event_section_locks_upd on public.event_section_locks;
create policy event_section_locks_upd on public.event_section_locks
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists event_section_locks_del on public.event_section_locks;
create policy event_section_locks_del on public.event_section_locks
  for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.event_section_locks to authenticated;

-- 2. The enforcement trigger function ------------------------------------

create or replace function app.enforce_section_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section  text := tg_argv[0];
  v_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  -- The office keeps working while the field team is fenced out.
  if app.is_admin() then
    return coalesce(new, old);
  end if;

  if v_event_id is null then
    return coalesce(new, old);
  end if;

  if exists (
    select 1 from public.event_section_locks l
     where l.event_id = v_event_id
       and l.section = v_section
  ) then
    raise exception 'The % section is locked by an admin.', v_section
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

-- 3. Attach it to every table that belongs to a lockable section ---------
--
-- Each entry is (table, section). All of these carry `event_id`, which is what
-- the trigger reads. `drop trigger if exists` first makes the migration
-- replay-safe.

do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('guest_groups',      'rsvp'),
      ('guests',            'rsvp'),
      ('call_attempts',     'rsvp'),
      ('hotels',            'hospitality'),
      ('rooms',             'hospitality'),
      ('room_assignments',  'hospitality'),
      ('deliverables',      'hamper'),
      ('delivery_proofs',   'hamper'),
      ('travel_legs',       'logistics'),
      ('trips',             'logistics'),
      ('trip_passengers',   'logistics')
    ) as t(tbl, sect)
  loop
    execute format('drop trigger if exists %I on public.%I', v.tbl || '_section_lock', v.tbl);
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each row execute function app.enforce_section_lock(%L)',
      v.tbl || '_section_lock', v.tbl, v.sect
    );
  end loop;
end $$;


-- ============================================================
-- [6/7] 20260925170000_event_notification_settings.sql
-- ============================================================
-- =====================================================================
-- A9 - ARRIVAL NOTIFICATION SETTING
--
-- One admin on/off switch per event for arrival notifications (the in-app
-- banner and, when configured, push). Defaults to ON, so an existing event
-- starts notifying without anyone having to find the switch.
--
-- Staff read it (to decide whether to render the banner); only an admin writes
-- it. Enforced by RLS like every other per-event setting.
-- =====================================================================

create table if not exists public.event_notification_settings (
  event_id         uuid primary key references public.events (id) on delete cascade,
  arrivals_enabled boolean not null default true,
  updated_at       timestamptz not null default now()
);

comment on table public.event_notification_settings is
  'Per-event notification switches. arrivals_enabled gates the arrival banner and push (A9).';

alter table public.event_notification_settings enable row level security;

drop policy if exists event_notification_settings_sel on public.event_notification_settings;
create policy event_notification_settings_sel on public.event_notification_settings
  for select to authenticated using (app.is_staff(event_id));

drop policy if exists event_notification_settings_ins on public.event_notification_settings;
create policy event_notification_settings_ins on public.event_notification_settings
  for insert to authenticated with check (app.is_admin());

drop policy if exists event_notification_settings_upd on public.event_notification_settings;
create policy event_notification_settings_upd on public.event_notification_settings
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists event_notification_settings_del on public.event_notification_settings;
create policy event_notification_settings_del on public.event_notification_settings
  for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.event_notification_settings to authenticated;


-- ============================================================
-- [7/7] 20260925180000_export_files.sql
-- ============================================================
-- =====================================================================
-- A11 - THE FILES AREA: EXPORT HISTORY + PRIVATE EXPORT BUCKET
--
-- Every generated export is uploaded to a private bucket and recorded here, so
-- an admin can re-download yesterday's rooming list without re-reading the
-- event. RLS is by event, exactly like every other event-scoped table.
--
-- The bucket is private and its objects policies fence each object by the event
-- id in the FIRST path folder (`<event_id>/<kind>-<stamp>.<ext>`), which
-- `app.is_staff` verifies â€” the same pattern as the call-recordings and
-- delivery-proofs buckets (20260731000500_rls.sql).
-- =====================================================================

-- 1. The history table ---------------------------------------------------

create table if not exists public.export_files (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  kind       text not null,
  format     text not null,
  path       text not null,
  bytes      bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists export_files_event_created_idx
  on public.export_files (event_id, created_at desc);

comment on table public.export_files is
  'One row per generated export; path is the object key in the eventflow-exports bucket.';

alter table public.export_files enable row level security;

drop policy if exists export_files_sel on public.export_files;
create policy export_files_sel on public.export_files
  for select to authenticated using (app.is_staff(event_id));

drop policy if exists export_files_ins on public.export_files;
create policy export_files_ins on public.export_files
  for insert to authenticated with check (app.is_staff(event_id));

drop policy if exists export_files_del on public.export_files;
create policy export_files_del on public.export_files
  for delete to authenticated using (app.is_admin());

grant select, insert, delete on public.export_files to authenticated;

-- 2. The private bucket + its policies -----------------------------------

insert into storage.buckets (id, name, public)
values ('eventflow-exports', 'eventflow-exports', false)
on conflict (id) do nothing;

drop policy if exists "staff read exports" on storage.objects;
create policy "staff read exports"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff write exports" on storage.objects;
create policy "staff write exports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

-- Regenerating the same kind replaces its object (the adapter upserts), which
-- needs an update policy as well as an insert one.
drop policy if exists "staff update exports" on storage.objects;
create policy "staff update exports"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

