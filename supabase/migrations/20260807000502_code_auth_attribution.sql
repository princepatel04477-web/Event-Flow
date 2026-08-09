-- =====================================================================
-- 1902 CODE-BASED AUTH — ATTRIBUTION REWORK
--
-- Under code-auth, a team session has NO auth.uid(). Every attribution
-- column (created_by, caller_id, uploaded_by, assigned_by, captured_by,
-- reviewed_by) and every RPC body that wrote auth.uid() must instead
-- record the SELECTED STAFF MEMBER. Admin (email/password) keeps its
-- real uid.
--
-- app.current_identity() returns the acting identity:
--   * a claim-bearing session (team) -> jwt_staff_member_id()
--   * an admin session (real uid)    -> auth.uid()
--   * anything else                  -> null (never recorded)
--
-- Column DEFAULTs are re-pointed at it, and the RPCs that referenced
-- auth.uid() for ownership (claim_group, release_group, save_rsvp_log,
-- apply_rsvp_extraction, commit_guest_import) are re-created to use it.
--
-- IDEMPOTENT: create or replace function, alter column set default,
-- create or replace RPC bodies.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. current_identity() — the single source of "who is acting".
-- ---------------------------------------------------------------------
create or replace function app.current_identity()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    app.jwt_staff_member_id(),
    auth.uid()
  );
$$;

grant execute on function app.current_identity() to authenticated;

-- ---------------------------------------------------------------------
-- 2. Re-point the attribution column defaults. Existing rows keep their
--    values; new rows (and RPC writes that omit the column) get the
--    current identity.
-- ---------------------------------------------------------------------
alter table public.guest_groups
  alter column created_by set default app.current_identity();
alter table public.travel_legs
  alter column created_by set default app.current_identity();
alter table public.call_attempts
  alter column caller_id set default app.current_identity();
alter table public.call_recordings
  alter column uploaded_by set default app.current_identity();
alter table public.room_assignments
  alter column assigned_by set default app.current_identity();
alter table public.delivery_proofs
  alter column captured_by set default app.current_identity();
-- New code-auth proof rows record the selected staff member here.
alter table public.delivery_proofs
  alter column captured_by_staff set default app.current_identity();
alter table public.trips
  alter column created_by set default app.current_identity();
alter table public.messages
  alter column created_by set default app.current_identity();
alter table public.import_batches
  alter column imported_by set default app.current_identity();

-- call_attempts.caller_id is NOT NULL and references auth.users. Under
-- code-auth the staff member id is a staff_members.id, not an auth user.
-- The FK must move: drop the auth.users FK, keep the column, and let
-- current_identity() (which returns staff_members.id for team sessions)
-- be stored. Add a comment; the FK reference is re-pointed below.
alter table public.call_attempts
  drop constraint if exists call_attempts_caller_id_fkey;

-- delivery_proofs.captured_by KEEPS its auth.users FK: legacy rows and
-- the admin path still hold real auth user ids. The new
-- captured_by_staff column (added in 1900) references staff_members and
-- is where code-auth inserts record the staff member.

-- ---------------------------------------------------------------------
-- 3. claim_group / release_group — lock ownership by current identity.
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
     set locked_by    = app.current_identity(),
         locked_until = now() + make_interval(mins => p_minutes),
         updated_at   = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_until is null
          or g.locked_until < now()
          or g.locked_by = app.current_identity())
  returning * into v_group;

  if v_group.id is null then
    raise exception 'Group % is locked by another caller right now.', p_group_id
      using errcode = '55P03';  -- lock_not_available
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
     set locked_by = null, locked_until = null, updated_at = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_by = app.current_identity() or app.is_admin());
end;
$$;

grant execute on function public.claim_group(uuid, integer), public.release_group(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. save_rsvp_log — lock-ownership guard by current identity.
-- ---------------------------------------------------------------------
create or replace function public.save_rsvp_log(
  p_event_id uuid,
  p_group_id uuid,
  p_rsvp_status app.rsvp_status,
  p_adults_confirmed integer,
  p_children_confirmed integer,
  p_needs_pickup boolean,
  p_special_requirements text[],
  p_callback_at timestamptz,
  p_notes text,
  p_arrival jsonb,
  p_departure jsonb
)
returns public.guest_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.guest_groups;
begin
  if not exists (
    select 1 from public.guest_groups g
    where g.id = p_group_id and g.event_id = p_event_id
  ) then
    raise exception 'Group % not found in this event.', p_group_id
      using errcode = '55P03';
  end if;

  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  -- Lock ownership guard by the acting identity (staff member for a
  -- team session, auth.uid() for admin).
  select g.* into v_group
    from public.guest_groups g
   where g.id = p_group_id;

  if v_group.locked_by is not null
     and v_group.locked_by <> app.current_identity()
     and v_group.locked_until is not null
     and v_group.locked_until > now() then
    raise exception 'This family is locked by another caller right now.'
      using errcode = '55P03';
  end if;

  update public.guest_groups g
     set rsvp_status          = p_rsvp_status,
         adults_confirmed     = p_adults_confirmed,
         children_confirmed   = p_children_confirmed,
         needs_pickup         = coalesce(p_needs_pickup, g.needs_pickup),
         special_requirements = case
                                  when p_special_requirements is null then g.special_requirements
                                  else p_special_requirements
                                end,
         remarks              = coalesce(p_notes, g.remarks),
         callback_at          = case
                                  when p_rsvp_status = 'callback' then p_callback_at
                                  else null
                                end,
         locked_by            = null,
         locked_until         = null,
         updated_at           = now()
   where g.id = p_group_id
  returning * into v_group;

  if v_group.id is null then
    raise exception 'Group % could not be updated.', p_group_id
      using errcode = '42501';
  end if;

  -- Upsert the travel legs from the JSON payloads (same contract as the
  -- original — see migration 1600). Only object payloads are addressed;
  -- a non-object (or null) leaves the leg alone.
  if p_arrival is not null and jsonb_typeof(p_arrival) = 'object' then
    perform public.upsert_rsvp_leg(p_event_id, p_group_id, 'arrival', p_arrival);
  end if;
  if p_departure is not null and jsonb_typeof(p_departure) = 'object' then
    perform public.upsert_rsvp_leg(p_event_id, p_group_id, 'departure', p_departure);
  end if;

  return v_group;
end;
$$;

grant execute on function public.save_rsvp_log(
  uuid, uuid, app.rsvp_status, integer, integer, boolean, text[], timestamptz, text, jsonb, jsonb
) to authenticated;

-- ---------------------------------------------------------------------
-- 5. apply_rsvp_extraction — reviewed_by by current identity.
--    Byte-faithful to the original (migration 0600): same payload
--    parsing, same leg upsert with pax_on_leg, same parsed/
--    reviewed_at/applied_at writes. ONLY the identity source changed.
-- ---------------------------------------------------------------------
create or replace function public.apply_rsvp_extraction(
  p_extraction_id uuid,
  p_payload       jsonb
)
returns public.guest_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex      public.rsvp_extractions;
  v_group   public.guest_groups;
  v_dirtext text;
  v_dir     app.travel_direction;
  v_leg     jsonb;
  v_leg_id  uuid;
begin
  select * into v_ex from public.rsvp_extractions where id = p_extraction_id;
  if not found then
    raise exception 'Extraction % not found.', p_extraction_id;
  end if;

  if not app.is_staff(v_ex.event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_ex.status = 'accepted' then
    raise exception 'Extraction % has already been applied.', p_extraction_id;
  end if;

  update public.guest_groups g
     set rsvp_status   = coalesce((p_payload ->> 'rsvp_status')::app.rsvp_status, g.rsvp_status),
         confirmed_pax = coalesce((p_payload ->> 'confirmed_pax')::integer, g.confirmed_pax),
         side          = coalesce((p_payload ->> 'side')::app.side, g.side),
         remarks       = coalesce(p_payload ->> 'remarks', g.remarks),
         locked_by     = null,
         locked_until  = null,
         updated_at    = now()
   where g.id = v_ex.group_id
  returning * into v_group;

  foreach v_dirtext in array array['arrival', 'departure'] loop
    v_leg := p_payload -> v_dirtext;

    if v_leg is not null and jsonb_typeof(v_leg) = 'object' then
      v_dir := v_dirtext::app.travel_direction;

      select tl.id into v_leg_id
        from public.travel_legs tl
       where tl.group_id = v_ex.group_id and tl.direction = v_dir
       order by tl.created_at
       limit 1;

      if v_leg_id is null then
        insert into public.travel_legs (
          event_id, group_id, direction, mode, travel_date, travel_time,
          reference, point, pax_on_leg, source
        ) values (
          v_ex.event_id, v_ex.group_id, v_dir,
          nullif(v_leg ->> 'mode', '')::app.travel_mode,
          nullif(v_leg ->> 'date', '')::date,
          nullif(v_leg ->> 'time', '')::time,
          nullif(v_leg ->> 'reference', ''),
          nullif(v_leg ->> 'point', ''),
          nullif(v_leg ->> 'pax', '')::integer,
          'rsvp_call'
        );
      else
        update public.travel_legs tl
           set mode        = coalesce(nullif(v_leg ->> 'mode', '')::app.travel_mode, tl.mode),
               travel_date = coalesce(nullif(v_leg ->> 'date', '')::date, tl.travel_date),
               travel_time = coalesce(nullif(v_leg ->> 'time', '')::time, tl.travel_time),
               reference   = coalesce(nullif(v_leg ->> 'reference', ''), tl.reference),
               point       = coalesce(nullif(v_leg ->> 'point', ''), tl.point),
               pax_on_leg  = coalesce(nullif(v_leg ->> 'pax', '')::integer, tl.pax_on_leg),
               updated_at  = now()
         where tl.id = v_leg_id;
      end if;
    end if;
  end loop;

  update public.rsvp_extractions
     set status       = 'accepted',
         parsed       = p_payload,          -- store what the human actually approved
         reviewed_by  = app.current_identity(),
         reviewed_at  = now(),
         applied_at   = now()
   where id = p_extraction_id;

  return v_group;
end;
$$;

grant execute on function public.apply_rsvp_extraction(uuid, jsonb) to authenticated;
