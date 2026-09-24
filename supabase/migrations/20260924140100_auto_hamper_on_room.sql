-- Every family with a room gets a hamper automatically. Before this, hampers
-- existed only after an admin pressed "Create them now", so the Hampers tab
-- was blank for any family allotted after that press.
create or replace function app.ensure_hamper_for_assignment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.released_at is not null or new.group_id is null then
    return new;
  end if;

  insert into public.deliverables (event_id, group_id, room_id, kind, quantity, item_name)
  values (new.event_id, new.group_id, new.room_id, 'hamper', 1, 'Welcome hamper')
  on conflict (group_id, kind) where guest_id is null
  do update set room_id = excluded.room_id, updated_at = now()
   where public.deliverables.status = 'pending'
     and public.deliverables.room_id is distinct from excluded.room_id;

  return new;
end;
$function$;

drop trigger if exists room_assignments_ensure_hamper on public.room_assignments;
create trigger room_assignments_ensure_hamper
  after insert or update of room_id, released_at on public.room_assignments
  for each row execute function app.ensure_hamper_for_assignment();

-- Backfill: families that already have a room but no hamper.
insert into public.deliverables (event_id, group_id, room_id, kind, quantity, item_name)
select distinct on (ra.group_id) ra.event_id, ra.group_id, ra.room_id, 'hamper', 1, 'Welcome hamper'
  from public.room_assignments ra
 where ra.released_at is null
   and ra.group_id is not null
 order by ra.group_id, ra.created_at
on conflict (group_id, kind) where guest_id is null do nothing;
