-- =====================================================================
-- M16: check_in_room covers all active assignments for a family
--
-- A family placed across multiple rooms has multiple active assignments.
-- check_in_room previously updated only the single oldest assignment,
-- while check_out_room updated all active assignments for the group.
-- This migration updates check_in_room to mark all active assignments
-- for the group as checked in.
-- =====================================================================

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

  -- Verify active unreleased assignments exist
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

  -- Lock all assigned rooms for this group to prevent concurrent occupancy conflicts
  perform r.id
     from public.rooms r
    where r.id in (
      select ra.room_id
        from public.room_assignments ra
       where ra.event_id = p_event_id
         and ra.group_id = p_group_id
         and ra.released_at is null
    )
    for update;

  -- Check if any of these rooms is occupied by another family
  select g.head_name into v_occupant
    from public.room_assignments ra_other
    join public.guest_groups g
      on g.id = ra_other.group_id and g.event_id = ra_other.event_id
   where ra_other.event_id = p_event_id
     and ra_other.room_id in (
       select ra.room_id
         from public.room_assignments ra
        where ra.event_id = p_event_id
          and ra.group_id = p_group_id
          and ra.released_at is null
     )
     and ra_other.group_id <> p_group_id
     and ra_other.released_at is null
     and ra_other.checked_in_at is not null
     and ra_other.checked_out_at is null
   limit 1;

  if v_occupant is not null then
    raise exception 'Room is already occupied by %. Check them out first.', v_occupant
      using errcode = '23514';
  end if;

  -- Stamp check-in on all active assignments of this family
  update public.room_assignments ra
     set checked_in_at  = coalesce(checked_in_at, now()),
         checked_out_at = null,
         updated_at     = now()
   where ra.event_id = p_event_id
     and ra.group_id = p_group_id
     and ra.released_at is null;

  select ra.* into v_assign
    from public.room_assignments ra
   where ra.event_id = p_event_id
     and ra.group_id = p_group_id
     and ra.released_at is null
   order by ra.created_at
   limit 1;

  return v_assign;
end;
$$;

grant execute on function public.check_in_room(uuid, uuid)
  to authenticated;
