-- =====================================================================
-- FLEET MODULE — drivers / vehicle_assignments / odometer_logs + trips
-- and vehicles ALTERs. The event team's biggest ask (reforms of
-- software.txt, ~70%): KM counting, driver assignment, spare-time
-- tracking, fairness, manual odometer entry.
--
-- DESIGN (do not weaken):
--   * event-scoped RLS on every new table, same shape as every sibling:
--     select = staff, insert/update = staff + has_staff_identity,
--     delete = admin (via app.apply_staff_policies, 1901 pattern).
--   * CHECK constraints stated explicitly, including end_km >= start_km.
--   * Server-clock only: recorded_at/created_at are now() defaults, never
--     client-supplied. odometer_logs uses app.force_server_recorded_at().
--   * NO stored aggregates. KM totals, availability windows, fairness
--     ranking are all query-time. Storing them creates drift.
--   * Attribution pairs (created_by / created_by_staff) follow the house
--     pattern: num_nonnulls(...) <= 1, FK to staff_members(id) ON DELETE
--     RESTRICT, routed by app.route_attribution() on insert/update.
--   * trips.pickup_point / drop_point are kept (the runbook's proposed
--     pickup_location / drop_location would duplicate them). No rename.
--   * trips.driver_id is OPTIONAL (nullable) — a trip is planned before
--     it is assigned. Driver identity is resolved from vehicle_assignments
--     at read time; trips.driver_id is an explicit optional link.
--   * drivers.mobile is normalised 10-digit, matching primary_mobile.
--
-- IDEMPOTENT: create table if not exists, drop constraint if exists,
-- create or replace function, drop policy if exists, drop trigger if
-- exists, DO-block enum guards where a type could be added.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. DRIVERS — the named driver roster per event.
-- ---------------------------------------------------------------------
create table if not exists public.drivers (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  full_name     text not null,
  mobile        text,                          -- normalised 10-digit, or null
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (id, event_id)
);

create unique index if not exists drivers_event_name_uq
  on public.drivers (event_id, lower(full_name));

comment on table public.drivers is
  'The driver roster for one event. A driver is a person who can be '
  'assigned to a vehicle for a day via vehicle_assignments.';

-- ---------------------------------------------------------------------
-- 2. VEHICLE_ASSIGNMENTS — which driver has which vehicle on which day.
--    Drivers swap cars per day; this join makes that a fact.
-- ---------------------------------------------------------------------
create table if not exists public.vehicle_assignments (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  vehicle_id    uuid not null,
  driver_id     uuid not null,
  assign_date   date not null,                 -- the day this pairing is live
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (id, event_id),
  foreign key (vehicle_id, event_id)
    references public.vehicles (id, event_id) on delete cascade,
  foreign key (driver_id, event_id)
    references public.drivers (id, event_id) on delete cascade
);

create index if not exists vehicle_assignments_event_date_idx
  on public.vehicle_assignments (event_id, assign_date);

-- One vehicle can be assigned to at most one driver per day, and one
-- driver to at most one vehicle per day.
create unique index if not exists vehicle_assignments_one_per_day
  on public.vehicle_assignments (event_id, vehicle_id, assign_date);
create unique index if not exists vehicle_assignments_driver_per_day
  on public.vehicle_assignments (event_id, driver_id, assign_date);

-- ---------------------------------------------------------------------
-- 3. ODOMETER_LOGS — per vehicle per day, manual entry from the field.
--    Server-clock timestamps; NO stored aggregates (KM totals are sum()).
-- ---------------------------------------------------------------------
create table if not exists public.odometer_logs (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  vehicle_id    uuid not null,
  log_date      date not null,                 -- which day this reading is for
  start_km      integer not null check (start_km >= 0),
  end_km        integer not null check (end_km >= 0),
  start_time    time,                          -- shift start, time-of-day
  end_time      time,                          -- shift end, time-of-day
  recorded_at   timestamptz not null default now(),  -- server clock
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  unique (id, event_id),
  foreign key (vehicle_id, event_id)
    references public.vehicles (id, event_id) on delete cascade,
  check (end_km >= start_km)
);

create index if not exists odometer_logs_event_vehicle_date_idx
  on public.odometer_logs (event_id, vehicle_id, log_date desc);

drop trigger if exists odometer_logs_server_clock on public.odometer_logs;
create trigger odometer_logs_server_clock
  before insert on public.odometer_logs
  for each row execute function app.force_server_recorded_at();

-- ---------------------------------------------------------------------
-- 4. VEHICLES ALTER — attribution pair (created_by / created_by_staff).
-- ---------------------------------------------------------------------
alter table public.vehicles
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.vehicles drop constraint if exists vehicles_created_by_one_of;
alter table public.vehicles
  add constraint vehicles_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

-- ---------------------------------------------------------------------
-- 5. DRIVERS / VEHICLE_ASSIGNMENTS / ODOMETER_LOGS attribution pairs.
-- ---------------------------------------------------------------------
alter table public.drivers
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.drivers drop constraint if exists drivers_created_by_one_of;
alter table public.drivers
  add constraint drivers_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

alter table public.vehicle_assignments
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.vehicle_assignments drop constraint if exists vehicle_assignments_created_by_one_of;
alter table public.vehicle_assignments
  add constraint vehicle_assignments_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

alter table public.odometer_logs
  add column if not exists created_by uuid references auth.users (id),
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.odometer_logs drop constraint if exists odometer_logs_created_by_one_of;
alter table public.odometer_logs
  add constraint odometer_logs_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

-- ---------------------------------------------------------------------
-- 6. TRIPS ALTER — optional driver link.
-- ---------------------------------------------------------------------
alter table public.trips
  add column if not exists driver_id uuid;

alter table public.trips drop constraint if exists trips_driver_fk;
alter table public.trips
  add constraint trips_driver_fk
    foreign key (driver_id, event_id)
    references public.drivers (id, event_id) on delete set null;

-- ---------------------------------------------------------------------
-- 7. ROUTE_ATTRIBUTION — add the four new branches INSIDE the function.
--    The function dispatches on TG_TABLE_NAME; attaching the old function
--    to a new table would fall through to `return NEW` and do nothing.
-- ---------------------------------------------------------------------
create or replace function app.route_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := app.current_staff_id();
  v_auth  uuid := app.current_auth_uid();
begin
  -- Attribution is set at INSERT and never re-routed on UPDATE: an UPDATE
  -- that clears a pair (release_group, a correction) must stay cleared, and
  -- re-attributing a row to whoever happened to touch it last would falsify
  -- the audit trail. Only fill pairs that are entirely unset.
  if TG_TABLE_NAME = 'guest_groups' then
    if TG_OP = 'INSERT' then
      if NEW.locked_by is null and NEW.locked_by_staff is null then
        if v_staff is not null then NEW.locked_by_staff := v_staff;
        else NEW.locked_by := v_auth; end if;
      end if;
    end if;
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'call_attempts' then
    if NEW.caller_id is null and NEW.caller_id_staff is null then
      if v_staff is not null then NEW.caller_id_staff := v_staff;
      else NEW.caller_id := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'travel_legs' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'call_recordings' then
    if NEW.uploaded_by is null and NEW.uploaded_by_staff is null then
      if v_staff is not null then NEW.uploaded_by_staff := v_staff;
      else NEW.uploaded_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'room_assignments' then
    if NEW.assigned_by is null and NEW.assigned_by_staff is null then
      if v_staff is not null then NEW.assigned_by_staff := v_staff;
      else NEW.assigned_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'trips' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'messages' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'import_batches' then
    if NEW.imported_by is null and NEW.imported_by_staff is null then
      if v_staff is not null then NEW.imported_by_staff := v_staff;
      else NEW.imported_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'delivery_proofs' then
    if NEW.captured_by is null and NEW.captured_by_staff is null then
      if v_staff is not null then NEW.captured_by_staff := v_staff;
      else NEW.captured_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'vehicles' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'drivers' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'vehicle_assignments' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'odometer_logs' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

-- Attach routing triggers (insert or update, matching siblings).
drop trigger if exists vehicles_attribution on public.vehicles;
create trigger vehicles_attribution
  before insert or update on public.vehicles
  for each row execute function app.route_attribution();

drop trigger if exists drivers_attribution on public.drivers;
create trigger drivers_attribution
  before insert or update on public.drivers
  for each row execute function app.route_attribution();

drop trigger if exists vehicle_assignments_attribution on public.vehicle_assignments;
create trigger vehicle_assignments_attribution
  before insert or update on public.vehicle_assignments
  for each row execute function app.route_attribution();

drop trigger if exists odometer_logs_attribution on public.odometer_logs;
create trigger odometer_logs_attribution
  before insert or update on public.odometer_logs
  for each row execute function app.route_attribution();

-- ---------------------------------------------------------------------
-- 8. RLS — full staff policy set on the new tables + vehicles.
--    NOTE: app.apply_staff_policies() (1901) still carries the
--    has_staff_identity conjunct that 20260814140000 removed from the 17
--    existing tables inline. The fleet tables must match the CURRENT live
--    shape — staff-scoped, no identity gate — or team writes fail the way
--    the pre-reform app did. So we create the policies explicitly here,
--    mirroring 20260814140000's shape exactly.
-- ---------------------------------------------------------------------
alter table public.vehicles            enable row level security;
alter table public.vehicles            force row level security;
alter table public.drivers             enable row level security;
alter table public.drivers             force row level security;
alter table public.vehicle_assignments enable row level security;
alter table public.vehicle_assignments force row level security;
alter table public.odometer_logs       enable row level security;
alter table public.odometer_logs       force row level security;

do $$
declare
  t text;
  tables text[] := array['vehicles', 'drivers', 'vehicle_assignments', 'odometer_logs'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_sel', t);
    execute format(
      'create policy %I on public.%I for select to authenticated
         using (app.is_staff(event_id))', t || '_sel', t);

    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (app.is_staff(event_id))', t || '_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (app.is_staff(event_id))
         with check (app.is_staff(event_id))', t || '_upd', t);

    execute format('drop policy if exists %I on public.%I', t || '_del', t);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (app.is_admin())', t || '_del', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 9. STANDARD TRIGGERS — audit + touch_updated_at on the NEW tables.
--    vehicles already has them from 20260731000300/0400 — re-attaching
--    would collide with the existing vehicles_audit trigger.
-- ---------------------------------------------------------------------
select app.attach_standard_triggers('public.drivers');
select app.attach_standard_triggers('public.vehicle_assignments');
select app.attach_standard_triggers('public.odometer_logs');
