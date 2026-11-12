-- =====================================================================
-- ADMIN HARD DELETE FOR EVENTS
--
-- Previously events were soft-delete only (archived_at) because several
-- append-only / audit tables carry `BEFORE DELETE` blockers and `staff_members`
-- / `delivery_proofs` carry `ON DELETE RESTRICT` foreign keys.
--
-- To let an admin permanently delete an event without weakening row-level
-- audit protections during normal operation:
--   1. The `DELETE` branches in `app.block_mutation()`,
--      `app.guard_call_attempt()`, and `app.block_staff_member_delete()` allow
--      deletion ONLY when the transaction-local setting `app.deleting_event_id`
--      matches `old.event_id` AND the caller is an admin (or service_role).
--      Row-level UPDATE/DELETE outside `public.delete_event()` remains blocked.
--   2. `public.delete_event(p_event_id uuid)` verifies `app.is_admin()` (or
--      service_role), sets the transaction-local `app.deleting_event_id`,
--      removes child rows in bottom-up dependency order so `ON DELETE RESTRICT`
--      constraints never trip, and finally deletes the row from `public.events`
--      (which logs the deletion in `public.audit_log` via `events_audit`).
-- =====================================================================

-- 1. Scope insert-only / append-only delete triggers to whole-event deletion --

create or replace function app.block_mutation()
returns trigger
language plpgsql
as $$
declare
  v_deleting text;
begin
  if tg_op = 'DELETE' then
    v_deleting := nullif(current_setting('app.deleting_event_id', true), '');
    if v_deleting is not null
       and (to_jsonb(old) ->> 'event_id') = v_deleting
       and (app.is_admin() or current_setting('request.jwt.claim.role', true) = 'service_role')
    then
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
    if nullif(current_setting('app.deleting_event_id', true), '') = old.event_id::text
       and (app.is_admin() or current_setting('request.jwt.claim.role', true) = 'service_role')
    then
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
  if nullif(current_setting('app.deleting_event_id', true), '') = old.event_id::text
     and (app.is_admin() or current_setting('request.jwt.claim.role', true) = 'service_role')
  then
    return old;
  end if;

  raise exception 'staff_members is soft-delete only; set is_active = false instead. Deleting would orphan attribution that can never be corrected.'
    using errcode = '42501';
end;
$$;

-- 2. Atomic admin-only event deletion RPC ------------------------------------

create or replace function public.delete_event(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event record;
begin
  if not (app.is_admin() or current_setting('request.jwt.claim.role', true) = 'service_role') then
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

  -- Remaining event-scoped tables (hotels, rooms, codes, members, exports,
  -- templates, settings, reveal log, etc.) cascade from events.
  delete from public.events                  where id = p_event_id;

  return jsonb_build_object(
    'deleted', true,
    'id', v_event.id,
    'code', v_event.code,
    'name', v_event.name
  );
end;
$$;

revoke all on function public.delete_event(uuid) from public;
grant execute on function public.delete_event(uuid) to authenticated;

comment on column public.events.archived_at is
  'Soft delete. Non-null hides the event from the admin list by default. '
  'Permanent removal goes through public.delete_event(uuid) (admin-only).';
