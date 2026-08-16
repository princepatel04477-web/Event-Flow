-- =====================================================================
-- CONCURRENCY FIX — guard_room_assignment: lock the room row
--
-- HOLE: app.guard_room_assignment() is a row-level BEFORE trigger that
-- does a plain COUNT of the target room's active rows. Under READ
-- COMMITTED, two concurrent transactions placing into the SAME room each
-- run the COUNT before the other commits — both see the same under-filled
-- count, both pass, and the room commits over capacity with NO error.
-- Same-statement atomicity (verified in R0.2) does not extend to
-- cross-transaction concurrency. Two handsets placing into one room in
-- the same instant is the exact case.
--
-- FIX: take a row lock on the room inside the guard (SELECT ... FOR
-- UPDATE). The second transaction's lock waits until the first commits,
-- then its COUNT sees the committed rows and correctly refuses. This
-- serialises placements per room, which is precisely the resource being
-- contested. The function is security definer and runs as the table
-- owner, so it can lock the room row.
--
-- The lock is taken on the ROOM row, not the assignment rows, so it
-- costs nothing for placements into different rooms (they lock different
-- rows and proceed in parallel).
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

  -- FOR UPDATE: serialise concurrent placements into the SAME room. The
  -- second transaction blocks here until the first commits, so its COUNT
  -- below sees the committed rows and the capacity check is race-free.
  select r.room_number, r.capacity, r.max_capacity
    into v_room, v_capacity, v_max
    from public.rooms r
   where r.id = new.room_id
     for update;

  v_room := coalesce(v_room, 'unknown');
  -- max_capacity may be null on a pre-backfill row; fall back to capacity.
  v_max := coalesce(v_max, v_capacity);

  -- Check-out before check-in is always nonsense, whatever the dates are.
  if coalesce(new.check_out_date, 'infinity'::date) < coalesce(new.check_in_date, '-infinity'::date) then
    raise exception 'Room % check-out % is before check-in %.', v_room, new.check_out_date, new.check_in_date
      using errcode = '23514';
  end if;

  -- Count ACTIVE assignments whose stay OVERLAPS this one's, excluding the
  -- row itself. The room row lock above makes this count race-free.
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

  if v_overlap + 1 > v_max and not new.is_override then
    raise exception
      'Room % is at max capacity (max %, % overlapping stay% currently). Set is_override with a reason to force.',
      v_room, v_max, v_overlap, case when v_overlap = 1 then '' else 's' end
      using errcode = '23514';
  end if;

  return new;
end;
$$;

-- The trigger is unchanged; only the function body gained the row lock.
drop trigger if exists room_assignments_capacity on public.room_assignments;
create trigger room_assignments_capacity
  before insert or update on public.room_assignments
  for each row execute function app.guard_room_assignment();
