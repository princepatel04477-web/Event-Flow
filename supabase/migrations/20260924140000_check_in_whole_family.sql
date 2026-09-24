-- Check-in marks EVERY active assignment of the family, not just the first.
-- Assignments are one row per guest, so a 2-person family in a 2-bed room has
-- two rows; the old `limit 1` checked in one guest and left the other stuck.
-- The occupancy guard now counts beds instead of blocking on "someone else is
-- in": other families' checked-in guests + this family's guests in the room
-- must fit the room's max capacity (same rule the allocation trigger uses).
create or replace function public.check_in_room(p_event_id uuid, p_group_id uuid)
returns public.room_assignments
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_assign   public.room_assignments;
  v_room     record;
  v_others   integer;
  v_mine     integer;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.room_assignments ra
     where ra.event_id = p_event_id and ra.group_id = p_group_id and ra.released_at is null
  ) then
    raise exception 'This family has no allocated room. Allocate one before check-in.'
      using errcode = '23503';
  end if;

  -- Lock every room this family is placed in, then check bed counts per room.
  for v_room in
    select r.id, r.room_number, coalesce(r.max_capacity, r.capacity) as max_beds
      from public.rooms r
     where r.id in (
       select ra.room_id from public.room_assignments ra
        where ra.event_id = p_event_id and ra.group_id = p_group_id and ra.released_at is null)
     order by r.id
     for update
  loop
    select count(*) into v_others
      from public.room_assignments ra
     where ra.event_id = p_event_id
       and ra.room_id = v_room.id
       and ra.group_id <> p_group_id
       and ra.released_at is null
       and ra.checked_in_at is not null
       and ra.checked_out_at is null;

    select count(*) into v_mine
      from public.room_assignments ra
     where ra.event_id = p_event_id
       and ra.room_id = v_room.id
       and ra.group_id = p_group_id
       and ra.released_at is null;

    if v_others + v_mine > v_room.max_beds then
      raise exception 'Room % has only % bed(s) free — check someone out first.',
        v_room.room_number, greatest(v_room.max_beds - v_others, 0)
        using errcode = '55P03';
    end if;
  end loop;

  update public.room_assignments ra
     set checked_in_at  = coalesce(ra.checked_in_at, now()),
         checked_out_at = null,
         updated_at     = now()
   where ra.event_id = p_event_id
     and ra.group_id = p_group_id
     and ra.released_at is null;

  select ra.* into v_assign
    from public.room_assignments ra
   where ra.event_id = p_event_id and ra.group_id = p_group_id and ra.released_at is null
   order by ra.created_at
   limit 1;

  return v_assign;
end;
$function$;
