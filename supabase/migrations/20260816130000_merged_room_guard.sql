-- =====================================================================
-- MERGED ROOM GUARD — date-aware AND capacity-aware.
--
-- Replaces BOTH app.guard_room_overlap and app.guard_room_capacity with
-- a single guard. The old overlap guard made rooms single-occupancy:
-- it raised 23514 if ANY other active assignment on the same room had an
-- overlapping date range, with no capacity awareness, so a second person
-- in a capacity-2 room always raised and a dateless assignment blocked
-- the room forever (null dates coalesce to -infinity/infinity). The old
-- capacity guard counted ALL active assignments against max_capacity,
-- ignoring dates, so sequential non-overlapping stays wrongly counted
-- against each other. Both fired on the same INSERT and overlap won.
--
-- The merged guard counts only ACTIVE assignments whose date range
-- OVERLAPS the new row's, and raises only if that count + 1 would exceed
-- max_capacity (coalesced to capacity). is_override remains the escape
-- hatch, matching the current capacity-guard behaviour. The overlap
-- trigger is dropped; a date-aware capacity check subsumes the
-- booking-clash branch.
--
-- IDEMPOTENT: create or replace function, drop trigger if exists.
-- =====================================================================

create or replace function app.guard_room_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room     text;
  v_max      integer;
  v_capacity integer;
  v_overlap  integer;
begin
  -- Released rows are history — never block a new booking.
  if new.released_at is not null then
    return new;
  end if;

  select r.room_number, r.capacity, r.max_capacity
    into v_room, v_capacity, v_max
    from public.rooms r
   where r.id = new.room_id;

  v_room := coalesce(v_room, 'unknown');
  -- max_capacity may be null on a pre-backfill row; fall back to capacity.
  v_max := coalesce(v_max, v_capacity);

  -- Check-out before check-in is always nonsense, whatever the dates are.
  if coalesce(new.check_out_date, 'infinity'::date) < coalesce(new.check_in_date, '-infinity'::date) then
    raise exception 'Room % check-out % is before check-in %.', v_room, new.check_out_date, new.check_in_date
      using errcode = '23514';
  end if;

  -- Count ACTIVE assignments whose stay OVERLAPS this one's, excluding the
  -- row itself (an UPDATE re-check must not count its own current dates).
  select count(*)
    into v_overlap
    from public.room_assignments ra
   where ra.room_id = new.room_id
     and ra.released_at is null
     and ra.id is distinct from new.id
     and daterange(
           coalesce(ra.check_in_date, '-infinity'::date),
           coalesce(ra.check_out_date, 'infinity'::date),
           '[)'
         ) && daterange(
           coalesce(new.check_in_date, '-infinity'::date),
           coalesce(new.check_out_date, 'infinity'::date),
           '[)'
         );

  -- Date-aware capacity: the new row plus everyone whose stay overlaps it
  -- must fit within max_capacity. is_override is the escape hatch, exactly
  -- as the current capacity guard allows.
  if v_overlap + 1 > v_max and not new.is_override then
    raise exception
      'Room % is at max capacity (max %, % overlapping stay% currently). Set is_override with a reason to force.',
      v_room, v_max, v_overlap, case when v_overlap = 1 then '' else 's' end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- Drop the old overlap trigger; a date-aware capacity check subsumes the
-- booking-clash branch.
drop trigger if exists room_assignments_overlap on public.room_assignments;

-- Replace the old capacity trigger with the merged one.
drop trigger if exists room_assignments_capacity on public.room_assignments;
create trigger room_assignments_capacity
  before insert or update on public.room_assignments
  for each row execute function app.guard_room_assignment();
