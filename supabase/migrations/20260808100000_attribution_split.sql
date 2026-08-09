-- =====================================================================
-- 2100 ATTRIBUTION SPLIT — auth.uid() and staff_members.id cannot share a
-- single FK column.
--
-- WHY: app.current_identity() returns the selected staff_members.id for a
-- team (code-auth) session and auth.uid() for an admin. Every attribution
-- column whose default was re-pointed to current_identity() therefore holds
-- BOTH id types over time. A column can have ONE foreign key; pointing it
-- at auth.users breaks team writes (staff id is not an auth user — the
-- claim_group 23503), pointing it at staff_members breaks admin writes.
--
-- delivery_proofs set the precedent (captured_by + captured_by_staff): a
-- nullable _staff sibling column beside the original, exactly one non-null.
--
-- THIS MIGRATION applies that pattern to the nine current_identity-written
-- columns:
--   guest_groups.locked_by        + locked_by_staff
--   guest_groups.created_by       + created_by_staff
--   call_attempts.caller_id       + caller_id_staff
--   travel_legs.created_by        + created_by_staff
--   call_recordings.uploaded_by   + uploaded_by_staff
--   room_assignments.assigned_by  + assigned_by_staff
--   trips.created_by              + created_by_staff
--   messages.created_by           + created_by_staff
--   import_batches.imported_by    + imported_by_staff
--
-- delivery_proofs.captured_by is NOT touched: it is insert-only, legacy rows
-- hold auth ids, and the export already resolves captured_by_staff first.
--
-- ENFORCEMENT:
--   * CHECK constraint on each pair: for REQUIRED attribution columns (created,
--     caller, uploaded, assigned, imported) exactly one non-null
--     (num_nonnulls = 1). For the OPTIONAL lock (guest_groups.locked_by) at
--     most one non-null (num_nonnulls <= 1) — an unlocked group has both null.
--     In all cases a row attributed to BOTH an auth user and a staff member is
--     impossible: "who did this" is always answerable.
--   * FK on each _staff column: staff_members(id) ON DELETE RESTRICT — staff
--     are never hard-deleted once they hold attribution (soft-delete via
--     is_active only).
--   * A BEFORE INSERT OR UPDATE trigger routes the attribution: team session
--     (jwt_staff_member_id present) -> staff column; admin (auth.uid()) ->
--     original column. This replaces the current_identity() column defaults,
--     which cannot target a specific column.
--
-- IDEMPOTENT: add column if not exists, drop constraint if exists, create or
-- replace trigger/function.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HELPERS
-- ---------------------------------------------------------------------

-- The acting identity's STAFF id, or null (admin sessions have none).
create or replace function app.current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select app.jwt_staff_member_id();
$$;

-- The acting identity's AUTH uid, or null (team sessions have none).
create or replace function app.current_auth_uid()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid();
$$;

grant execute on function app.current_staff_id(), app.current_auth_uid() to authenticated;

-- ---------------------------------------------------------------------
-- 2. GUEST_GROUPS — locked_by (+_staff), created_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.guest_groups
  add column if not exists locked_by_staff uuid references public.staff_members (id) on delete restrict,
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

-- A lock is optional (a group is not always being called): the pair must
-- never hold BOTH ids (attribution would be ambiguous), but both null is the
-- unlocked state. Hence <= 1, not = 1.
alter table public.guest_groups drop constraint if exists guest_groups_attribution_one_of;
alter table public.guest_groups
  add constraint guest_groups_attribution_one_of check (
    num_nonnulls(locked_by, locked_by_staff) <= 1
  );

alter table public.guest_groups drop constraint if exists guest_groups_created_by_one_of;
alter table public.guest_groups
  add constraint guest_groups_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

-- Drop the current_identity() defaults (routing moves to the trigger).
alter table public.guest_groups
  alter column created_by drop default;

comment on column public.guest_groups.locked_by is
  'Auth uid who holds the caller lock (admin sessions). Mutually exclusive '
  'with locked_by_staff (team sessions) — enforced by check '
  'guest_groups_attribution_one_of.';
comment on column public.guest_groups.locked_by_staff is
  'Staff_members.id who holds the caller lock (team sessions). Mutually '
  'exclusive with locked_by (admin). See CLAUDE.md: paired attribution columns.';
comment on column public.guest_groups.created_by_staff is
  'Staff_members.id who created the row (team sessions). Mutually exclusive '
  'with created_by (admin).';

-- ---------------------------------------------------------------------
-- 3. CALL_ATTEMPTS — caller_id (+_staff)
-- ---------------------------------------------------------------------
-- caller_id was NOT NULL; the split keeps exactly-one-non-null (one of the
-- pair must be present), so the NOT NULL is enforced by the CHECK.
alter table public.call_attempts
  alter column caller_id drop not null,
  add column if not exists caller_id_staff uuid references public.staff_members (id) on delete restrict;

alter table public.call_attempts drop constraint if exists call_attempts_caller_one_of;
alter table public.call_attempts
  add constraint call_attempts_caller_one_of check (
    num_nonnulls(caller_id, caller_id_staff) = 1
  );

alter table public.call_attempts
  alter column caller_id drop default;

comment on column public.call_attempts.caller_id_staff is
  'Staff_members.id who placed the call (team sessions). Mutually exclusive '
  'with caller_id (admin).';

-- ---------------------------------------------------------------------
-- 4. TRAVEL_LEGS — created_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.travel_legs
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.travel_legs drop constraint if exists travel_legs_created_by_one_of;
alter table public.travel_legs
  add constraint travel_legs_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

alter table public.travel_legs
  alter column created_by drop default;

-- ---------------------------------------------------------------------
-- 5. CALL_RECORDINGS — uploaded_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.call_recordings
  add column if not exists uploaded_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.call_recordings drop constraint if exists call_recordings_uploaded_by_one_of;
alter table public.call_recordings
  add constraint call_recordings_uploaded_by_one_of check (
    num_nonnulls(uploaded_by, uploaded_by_staff) <= 1
  );

alter table public.call_recordings
  alter column uploaded_by drop default;

-- ---------------------------------------------------------------------
-- 6. ROOM_ASSIGNMENTS — assigned_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.room_assignments
  add column if not exists assigned_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.room_assignments drop constraint if exists room_assignments_assigned_by_one_of;
alter table public.room_assignments
  add constraint room_assignments_assigned_by_one_of check (
    num_nonnulls(assigned_by, assigned_by_staff) <= 1
  );

alter table public.room_assignments
  alter column assigned_by drop default;

-- ---------------------------------------------------------------------
-- 7. TRIPS — created_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.trips
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.trips drop constraint if exists trips_created_by_one_of;
alter table public.trips
  add constraint trips_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

alter table public.trips
  alter column created_by drop default;

-- ---------------------------------------------------------------------
-- 8. MESSAGES — created_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.messages
  add column if not exists created_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.messages drop constraint if exists messages_created_by_one_of;
alter table public.messages
  add constraint messages_created_by_one_of check (
    num_nonnulls(created_by, created_by_staff) <= 1
  );

alter table public.messages
  alter column created_by drop default;

-- ---------------------------------------------------------------------
-- 9. IMPORT_BATCHES — imported_by (+_staff)
-- ---------------------------------------------------------------------
alter table public.import_batches
  add column if not exists imported_by_staff uuid references public.staff_members (id) on delete restrict;

alter table public.import_batches drop constraint if exists import_batches_imported_by_one_of;
alter table public.import_batches
  add constraint import_batches_imported_by_one_of check (
    num_nonnulls(imported_by, imported_by_staff) <= 1
  );

alter table public.import_batches
  alter column imported_by drop default;

-- ---------------------------------------------------------------------
-- 10. ROUTING TRIGGERS — fill the pair from the session on insert/update.
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

  return NEW;
end;
$$;

drop trigger if exists guest_groups_attribution on public.guest_groups;
create trigger guest_groups_attribution
  before insert or update on public.guest_groups
  for each row execute function app.route_attribution();

drop trigger if exists call_attempts_attribution on public.call_attempts;
create trigger call_attempts_attribution
  before insert or update on public.call_attempts
  for each row execute function app.route_attribution();

drop trigger if exists travel_legs_attribution on public.travel_legs;
create trigger travel_legs_attribution
  before insert or update on public.travel_legs
  for each row execute function app.route_attribution();

drop trigger if exists call_recordings_attribution on public.call_recordings;
create trigger call_recordings_attribution
  before insert or update on public.call_recordings
  for each row execute function app.route_attribution();

drop trigger if exists room_assignments_attribution on public.room_assignments;
create trigger room_assignments_attribution
  before insert or update on public.room_assignments
  for each row execute function app.route_attribution();

drop trigger if exists trips_attribution on public.trips;
create trigger trips_attribution
  before insert or update on public.trips
  for each row execute function app.route_attribution();

drop trigger if exists messages_attribution on public.messages;
create trigger messages_attribution
  before insert or update on public.messages
  for each row execute function app.route_attribution();

drop trigger if exists import_batches_attribution on public.import_batches;
create trigger import_batches_attribution
  before insert or update on public.import_batches
  for each row execute function app.route_attribution();

-- ---------------------------------------------------------------------
-- 11. RPC UPDATES — claim_group / release_group write the staff lock.
-- ---------------------------------------------------------------------
create or replace function public.claim_group(p_group_id uuid, p_minutes integer default 15)
returns public.guest_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.guest_groups;
begin
  update public.guest_groups g
     set locked_by       = case when app.current_staff_id() is not null then null else app.current_auth_uid() end,
         locked_by_staff = case when app.current_staff_id() is not null then app.current_staff_id() else null end,
         locked_until    = now() + make_interval(mins => p_minutes),
         updated_at      = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_until is null
          or g.locked_until < now()
          or g.locked_by = app.current_identity()
          or g.locked_by_staff = app.current_staff_id())
  returning * into v_group;

  if v_group.id is null then
    raise exception 'Group % is locked by another caller right now.', p_group_id
      using errcode = '55P03';
  end if;

  return v_group;
end;
$$;

create or replace function public.release_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guest_groups g
     set locked_by = null, locked_by_staff = null, locked_until = null, updated_at = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_by = app.current_identity()
          or g.locked_by_staff = app.current_staff_id()
          or app.is_admin());
end;
$$;

grant execute on function public.claim_group(uuid, integer), public.release_group(uuid) to authenticated;
