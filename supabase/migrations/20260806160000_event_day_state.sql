-- =====================================================================
-- 1601 EVENT-DAY STATE: arrivals, departures, check-in / check-out
--
-- Live event-day state lives HERE, separate from the informational
-- dates already on the schema:
--   * travel_legs.arrived_at / departed_at — when the family actually
--     showed up / left. NULL = not yet. Server-stamped by the RPCs.
--   * room_assignments.checked_in_at / checked_out_at — the live
--     occupancy state. An assignment with checked_in_at set and
--     checked_out_at NULL is OCCUPIED; that is what the double-booking
--     guard reads.
--
-- All four are set ONLY from now() inside the RPCs below. The browser
-- never supplies a timestamp.
--
-- IDEMPOTENCY: every statement is safe to re-run. Columns are added with
-- IF NOT EXISTS, functions with CREATE OR REPLACE, grants are idempotent.
-- This migration is pushed repeatedly over a live database.
-- =====================================================================

alter table public.travel_legs
  add column if not exists arrived_at  timestamptz,
  add column if not exists departed_at timestamptz;

alter table public.room_assignments
  add column if not exists checked_in_at  timestamptz,
  add column if not exists checked_out_at timestamptz;

comment on column public.travel_legs.arrived_at is
  'Server-stamped moment the family arrived. NULL = not yet arrived.';
comment on column public.travel_legs.departed_at is
  'Server-stamped moment the family departed. NULL = not yet departed.';
comment on column public.room_assignments.checked_in_at is
  'Server-stamped check-in. An assignment with this set and checked_out_at NULL is OCCUPIED.';
comment on column public.room_assignments.checked_out_at is
  'Server-stamped check-out. Clears occupancy.';

-- ---------------------------------------------------------------------
-- RPC: mark a family arrived on their arrival leg.
-- ---------------------------------------------------------------------
create or replace function public.mark_arrived(
  p_event_id uuid,
  p_group_id uuid
)
returns public.travel_legs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leg public.travel_legs;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  update public.travel_legs tl
     set arrived_at = now()
   where tl.event_id = p_event_id
     and tl.group_id = p_group_id
     and tl.direction = 'arrival'
     and tl.arrived_at is null
  returning * into v_leg;

  if v_leg.id is null then
    -- Either no arrival leg exists, or it is already marked. Say which.
    select tl.* into v_leg
      from public.travel_legs tl
     where tl.event_id = p_event_id
       and tl.group_id = p_group_id
       and tl.direction = 'arrival'
     limit 1;
    if v_leg.id is null then
      raise exception 'No arrival leg exists for this family — add their travel details first.'
        using errcode = 'P0001';
    end if;
  end if;

  return v_leg;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: mark a family departed on their departure leg.
-- ---------------------------------------------------------------------
create or replace function public.mark_departed(
  p_event_id uuid,
  p_group_id uuid
)
returns public.travel_legs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leg public.travel_legs;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  update public.travel_legs tl
     set departed_at = now()
   where tl.event_id = p_event_id
     and tl.group_id = p_group_id
     and tl.direction = 'departure'
     and tl.departed_at is null
  returning * into v_leg;

  if v_leg.id is null then
    select tl.* into v_leg
      from public.travel_legs tl
     where tl.event_id = p_event_id
       and tl.group_id = p_group_id
       and tl.direction = 'departure'
     limit 1;
    if v_leg.id is null then
      raise exception 'No departure leg exists for this family — add their travel details first.'
        using errcode = 'P0001';
    end if;
  end if;

  return v_leg;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: check a family into their allocated room.
--
-- GUARDS (both enforced in the database, not just the UI):
--   1. No active assignment for this group → refused.
--   2. The target room is already occupied by ANOTHER active assignment
--      (checked_in_at set, checked_out_at null) → refused, naming who.
-- The room's own occupancy guard (room_assignments_overlap / capacity)
-- still applies on assignment; this is the live check-in gate.
-- ---------------------------------------------------------------------
create or replace function public.check_in_room(
  p_event_id uuid,
  p_group_id uuid
)
returns public.room_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assign  public.room_assignments;
  v_room_id uuid;
  v_occupant text;
  v_locked  uuid;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  -- The group's active (unreleased) assignment.
  select ra.* into v_assign
    from public.room_assignments ra
   where ra.event_id = p_event_id
     and ra.group_id = p_group_id
     and ra.released_at is null
   order by ra.created_at
   limit 1;

  if v_assign.id is null then
    raise exception 'This family has no allocated room. Allocate one before check-in.'
      using errcode = '23503';
  end if;

  v_room_id := v_assign.room_id;

  -- Serialize concurrent check-ins to this room: lock the room row so two
  -- families checking in to the same room simultaneously cannot both read
  -- "no occupant" and both proceed.
  select r.id into v_locked
    from public.rooms r
   where r.id = v_room_id
   for update;

  -- Guard: another ACTIVE (unreleased) assignment already checked into this
  -- room and not out? A soft-released assignment (released_at set) that was
  -- never checked out must NOT block a fresh check-in — release is the
  -- explicit "this family is done with the room" signal.
  select g.head_name into v_occupant
    from public.room_assignments ra
    join public.guest_groups g on g.id = ra.group_id
   where ra.event_id = p_event_id
     and ra.room_id = v_room_id
     and ra.released_at is null
     and ra.checked_in_at is not null
     and ra.checked_out_at is null
     and ra.id <> v_assign.id
   order by ra.checked_in_at
   limit 1;

  if v_occupant is not null then
    raise exception 'Room is occupied by % — check them out first.', v_occupant
      using errcode = '55P03';
  end if;

  update public.room_assignments ra
     set checked_in_at  = now(),
         checked_out_at = null,
         updated_at     = now()
   where ra.id = v_assign.id
  returning * into v_assign;

  return v_assign;
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: check a family out of their room. Prompts are UI-side; the DB
-- clears occupancy with a server stamp.
-- ---------------------------------------------------------------------
create or replace function public.check_out_room(
  p_event_id uuid,
  p_group_id uuid
)
returns public.room_assignments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_assign public.room_assignments;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  update public.room_assignments ra
     set checked_out_at = now(),
         updated_at     = now()
   where ra.event_id = p_event_id
     and ra.group_id = p_group_id
     and ra.released_at is null
     and ra.checked_in_at is not null
     and ra.checked_out_at is null
  returning * into v_assign;

  if v_assign.id is null then
    raise exception 'This family is not checked in, so there is nothing to check out.'
      using errcode = 'P0001';
  end if;

  return v_assign;
end;
$$;

grant execute on function public.mark_arrived(uuid, uuid),
                    public.mark_departed(uuid, uuid),
                    public.check_in_room(uuid, uuid),
                    public.check_out_room(uuid, uuid)
  to authenticated;
