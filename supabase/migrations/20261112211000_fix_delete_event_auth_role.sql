-- =====================================================================
-- FIX: Use non-null boolean auth check + auth.role() for delete_event
--
-- On modern Supabase PostgREST, JWT claims live in `request.jwt.claims`
-- (read via `auth.role()`), leaving `current_setting('request.jwt.claim.role', true)`
-- NULL. In 3-valued SQL logic, `false or NULL` evaluates to NULL, which
-- caused `if not (...)` in `delete_event()` to pass through while
-- `if ... and (app.is_admin() or ...)` in the trigger guards evaluated false.
--
-- Wrapping both halves with `coalesce(..., false)` and `auth.role()` keeps
-- authorization strictly two-valued (true/false) for every role.
-- =====================================================================

create or replace function app.can_delete_event_row(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_event_id is not null
     and nullif(current_setting('app.deleting_event_id', true), '') = p_event_id::text
     and (
       coalesce(app.is_admin(), false)
       or coalesce(auth.role(), '') = 'service_role'
     );
$$;

revoke all on function app.can_delete_event_row(uuid) from public;
grant execute on function app.can_delete_event_row(uuid) to authenticated, service_role;

create or replace function app.block_mutation()
returns trigger
language plpgsql
as $$
declare
  v_event_id uuid;
begin
  if tg_op = 'DELETE' then
    begin
      v_event_id := (to_jsonb(old) ->> 'event_id')::uuid;
    exception when others then
      v_event_id := null;
    end;

    if app.can_delete_event_row(v_event_id) then
      return old;
    end if;
  end if;

  raise exception
    'Table % is insert-only for audit integrity; % is not permitted.',
    tg_table_name, tg_op
    using errcode = '42501';
end;
$$;

create or replace function app.guard_call_attempt()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if app.can_delete_event_row(old.event_id) then
      return old;
    end if;

    raise exception 'call_attempts is append-only; delete is not permitted.'
      using errcode = '42501';
  end if;

  if old.finalized_at is not null then
    raise exception 'Call attempt % is finalized and cannot be edited.', old.id
      using errcode = '42501';
  end if;

  new.id            := old.id;
  new.event_id      := old.event_id;
  new.group_id      := old.group_id;
  new.caller_id     := old.caller_id;
  new.dialed_number := old.dialed_number;
  new.started_at    := old.started_at;

  if new.outcome is not null and old.outcome is null then
    new.finalized_at := now();
  end if;

  return new;
end;
$$;

create or replace function app.block_staff_member_delete()
returns trigger
language plpgsql
as $$
begin
  if app.can_delete_event_row(old.event_id) then
    return old;
  end if;

  raise exception 'staff_members is soft-delete only; set is_active = false instead. Deleting would orphan attribution that can never be corrected.'
    using errcode = '42501';
end;
$$;

create or replace function public.delete_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
  v_is_authorized boolean;
begin
  v_is_authorized := coalesce(app.is_admin(), false)
                     or coalesce(auth.role(), '') = 'service_role';

  if not v_is_authorized then
    raise exception 'Only an admin can delete an event.' using errcode = '42501';
  end if;

  select id, code, name
    into v_event
    from public.events
   where id = p_event_id;

  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'not_found');
  end if;

  -- Transaction-local authorization so row-level DELETE guards permit cleanup
  -- strictly for this event inside this single transaction.
  perform set_config('app.deleting_event_id', p_event_id::text, true);

  -- Clear section locks first so service-role cleanup is never fenced out.
  delete from public.event_section_locks     where event_id = p_event_id;

  -- Proof & call-intelligence leaves (strict dependency order).
  delete from public.delivery_proofs         where event_id = p_event_id;
  delete from public.extraction_field_reviews where event_id = p_event_id;
  delete from public.rsvp_campaign_jobs      where event_id = p_event_id;
  delete from public.rsvp_campaigns          where event_id = p_event_id;
  delete from public.rsvp_extractions        where event_id = p_event_id;
  delete from public.transcripts             where event_id = p_event_id;
  delete from public.call_recordings         where event_id = p_event_id;
  delete from public.call_attempts           where event_id = p_event_id;

  -- Operational tables that reference staff_members with ON DELETE RESTRICT.
  delete from public.deliverables            where event_id = p_event_id;
  delete from public.room_assignments        where event_id = p_event_id;
  delete from public.trip_passengers         where event_id = p_event_id;
  delete from public.trips                   where event_id = p_event_id;
  delete from public.odometer_logs           where event_id = p_event_id;
  delete from public.vehicle_assignments     where event_id = p_event_id;
  delete from public.vehicles                where event_id = p_event_id;
  delete from public.drivers                 where event_id = p_event_id;
  delete from public.travel_legs             where event_id = p_event_id;
  delete from public.messages                where event_id = p_event_id;
  delete from public.import_rows             where event_id = p_event_id;
  delete from public.import_batches          where event_id = p_event_id;
  delete from public.guests                  where event_id = p_event_id;
  delete from public.guest_groups            where event_id = p_event_id;

  -- Safe now that every staff attribution reference has been removed.
  delete from public.staff_members           where event_id = p_event_id;

  -- Remaining event-scoped tables cascade from events.
  delete from public.events                  where id = p_event_id;

  return jsonb_build_object(
    'deleted', true,
    'id', v_event.id,
    'code', v_event.code,
    'name', v_event.name
  );
end;
$$;
