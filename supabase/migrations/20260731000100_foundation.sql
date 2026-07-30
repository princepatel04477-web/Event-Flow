-- =====================================================================
-- 0100 FOUNDATION
-- Extensions, enum types, tenancy (events / profiles / event_members),
-- helper functions used by every RLS policy, audit log, guard triggers.
-- =====================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
grant usage on schema app to authenticated, anon, service_role;

-- ---------------------------------------------------------------------
-- ENUM TYPES
-- ---------------------------------------------------------------------

-- Global role. 'admin' = Prince + friend (see and edit every event).
-- 'member' = anyone whose access is granted per-event in event_members.
create type app.global_role as enum ('admin', 'member');

-- Per-event role.
-- 'event_team' = on-ground staff: calling, logistics, hampers, departures.
-- 'client'     = wedding family: read-only guest profile cards, nothing else.
create type app.event_role as enum ('event_team', 'client');

create type app.side          as enum ('bride', 'groom', 'both', 'other');
create type app.group_type    as enum ('family', 'couple', 'friends', 'single');
create type app.age_band      as enum ('adult', 'child', 'infant');

create type app.rsvp_status as enum (
  'not_started',   -- never dialled
  'attempted',     -- dialled, no answer yet
  'callback',      -- asked us to call back
  'tentative',     -- maybe / will confirm later
  'confirmed',     -- coming, pax known
  'declined',      -- not coming
  'unreachable'    -- wrong / dead number
);

create type app.travel_direction as enum ('arrival', 'departure');
create type app.travel_mode      as enum ('air', 'train', 'bus', 'cab', 'self_drive');

create type app.call_outcome as enum (
  'connected', 'no_answer', 'busy', 'switched_off',
  'wrong_number', 'callback', 'declined', 'other'
);

create type app.extraction_status as enum ('pending', 'accepted', 'rejected', 'superseded');

create type app.deliverable_kind   as enum ('hamper', 'return_gift');
create type app.deliverable_status as enum ('pending', 'assigned', 'delivered', 'not_required');

create type app.vehicle_status as enum ('available', 'assigned', 'unavailable');
create type app.trip_status    as enum ('planned', 'dispatched', 'completed', 'cancelled');

create type app.message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');

create type app.data_source as enum ('excel_import', 'rsvp_call', 'event_team', 'client', 'system');

-- ---------------------------------------------------------------------
-- TENANCY
-- ---------------------------------------------------------------------

create table public.events (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  code          text not null unique,          -- short slug, used in exports & logins
  bride_name    text,
  groom_name    text,
  venue_city    text,
  starts_on     date,
  ends_on       date,
  is_active     boolean not null default true,
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.events is
  'One row per wedding. EVERY operational table carries event_id and is fenced by it.';

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  full_name    text,
  phone        text,
  global_role  app.global_role not null default 'member',
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.event_members (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        app.event_role not null,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (event_id, user_id)
);

create index on public.event_members (user_id);

comment on table public.event_members is
  'Grants one login access to exactly one event. An event_team or client login '
  'cannot see, or even discover, any other event.';

-- Auto-create a profile row whenever a Supabase auth user is created.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.raw_user_meta_data ->> 'phone', new.phone)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------------
-- ACCESS HELPERS  (used by every RLS policy below)
-- security definer so policies never recurse back into RLS
-- ---------------------------------------------------------------------

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.global_role = 'admin'
      and p.is_active
  );
$$;

-- Named role_in_event (not event_role) to avoid clashing with the enum type.
create or replace function app.role_in_event(p_event_id uuid)
returns app.event_role
language sql
stable
security definer
set search_path = ''
as $$
  select m.role
  from public.event_members m
  where m.user_id = auth.uid()
    and m.event_id = p_event_id;
$$;

-- Staff = admin, or event_team scoped to this event. Staff read base tables.
create or replace function app.is_staff(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin() or app.role_in_event(p_event_id) = 'event_team';
$$;

-- Member = staff OR client. Clients only ever reach data through views.
create or replace function app.is_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin() or app.role_in_event(p_event_id) is not null;
$$;

grant execute on function app.is_admin(), app.role_in_event(uuid),
  app.is_staff(uuid), app.is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- UTILITY TRIGGERS
-- ---------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Hard stop for insert-only tables (delivery proof photos).
create or replace function app.block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception
    'Table % is insert-only for audit integrity; % is not permitted.',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

-- Overwrite any client-supplied recorded_at with the SERVER clock.
-- This is the guarantee that a phone with a wrong/tampered clock cannot
-- fake when a hamper photo was taken.
create or replace function app.force_server_recorded_at()
returns trigger
language plpgsql
as $$
begin
  new.recorded_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- AUDIT LOG
-- ---------------------------------------------------------------------

create table public.audit_log (
  id          bigint generated always as identity primary key,
  event_id    uuid,
  table_name  text not null,
  record_id   uuid,
  action      text not null,
  actor_id    uuid,
  old_data    jsonb,
  new_data    jsonb,
  at          timestamptz not null default now()
);

create index on public.audit_log (event_id, at desc);
create index on public.audit_log (table_name, record_id);

create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
  else
    v_new := to_jsonb(new);
  end if;

  insert into public.audit_log (
    event_id, table_name, record_id, action, actor_id, old_data, new_data
  )
  values (
    coalesce((v_new ->> 'event_id')::uuid, (v_old ->> 'event_id')::uuid),
    tg_table_name,
    coalesce((v_new ->> 'id')::uuid, (v_old ->> 'id')::uuid),
    tg_op,
    auth.uid(),
    v_old,
    v_new
  );

  return coalesce(new, old);
end;
$$;

-- Convenience: attach audit + updated_at to a table in one call.
create or replace function app.attach_standard_triggers(p_table regclass)
returns void
language plpgsql
as $$
declare
  v_name text := replace(replace(p_table::text, 'public.', ''), '"', '');
  v_has_updated boolean;
begin
  execute format(
    'create trigger %I after insert or update or delete on %s
       for each row execute function app.audit_trigger()',
    v_name || '_audit', p_table
  );

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = v_name
      and column_name = 'updated_at'
  ) into v_has_updated;

  if v_has_updated then
    execute format(
      'create trigger %I before update on %s
         for each row execute function app.touch_updated_at()',
      v_name || '_touch', p_table
    );
  end if;
end;
$$;

select app.attach_standard_triggers('public.events');
select app.attach_standard_triggers('public.profiles');
select app.attach_standard_triggers('public.event_members');
