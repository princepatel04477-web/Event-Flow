-- =====================================================================
-- P2 — code-auth sessions can no longer write a bogus auth uid into an
-- attribution column. Derived verbatim from the CURRENT definition in
-- 20260815120000_fleet_module.sql (all 10 branches preserved); the ONLY
-- change is the guard block inserted after begin.
-- =====================================================================

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
  -- P2 GUARD. app.current_auth_uid() is only a real auth.users row for a
  -- GoTrue (admin) session. A code-auth session's auth.uid() is the
  -- ACCESS CODE id — verify-access-code/index.ts:156 does
  -- .setSubject(opts.accessCodeId) — which is not in auth.users. Writing it
  -- into any attribution column raises 23503 against that column's FK.
  -- Treat a non-resolvable auth uid as no auth identity at all; every
  -- attribution CHECK is num_nonnulls(...) <= 1, so leaving BOTH columns
  -- null is legal on every table this trigger serves.
  if v_auth is not null and not exists (
    select 1 from auth.users u where u.id = v_auth
  ) then
    v_auth := null;
  end if;
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
