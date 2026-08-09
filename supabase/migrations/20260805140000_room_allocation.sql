-- =====================================================================
-- 1400 R2: room allocation hardening
-- =====================================================================
-- Three additions for the room-allocation engine:
--
--   1. rooms.max_capacity — the extra-bed ceiling. `capacity` stays the
--      base (what the room sleeps normally); max_capacity is the hard
--      ceiling the allocator and the guard trigger both enforce. Defaults
--      to capacity so existing rooms keep working.
--
--   2. A date-range overlap guard on room_assignments: no two ACTIVE
--      (unreleased) stays may overlap on the same room. Implemented as a
--      BEFORE INSERT/UPDATE trigger rather than an EXCLUDE constraint,
--      because room_assignments uses soft-release (released_at) and an
--      EXCLUDE cannot be partial — a released historical row would wrongly
--      block a future booking. The trigger applies only to unreleased rows,
--      which is exactly the real invariant.
--
--   3. The occupancy guard trigger is upgraded to count against
--      max_capacity (not capacity), still bypassable only with is_override.
--
-- The guard is the database-level guarantee the SRS demands (FR-ROOM-03):
-- application checks may suggest, but the DB refuses an overlap.
--
-- IDEMPOTENCY: columns and constraints are added IF NOT EXISTS (constraints
-- dropped first when they exist so a re-run re-adds them), triggers are
-- DROP IF EXISTS + CREATE. Pushed repeatedly over a live database.
-- =====================================================================

alter table public.rooms
  add column if not exists max_capacity integer;

update public.rooms set max_capacity = capacity where max_capacity is null;

alter table public.rooms
  alter column max_capacity set not null;

alter table public.rooms drop constraint if exists rooms_max_capacity_gt_0;
alter table public.rooms add constraint rooms_max_capacity_gt_0 check (max_capacity > 0);

alter table public.rooms drop constraint if exists rooms_max_capacity_ge_capacity;
alter table public.rooms add constraint rooms_max_capacity_ge_capacity check (max_capacity >= capacity);

comment on column public.rooms.capacity is
  'Base capacity — what the room sleeps normally.';
comment on column public.rooms.max_capacity is
  'Hard ceiling including the extra-bed case. Never exceed this.';

-- No two active stays may overlap on the same room. NULL check-in is
-- treated as unbounded-past, NULL check-out as open-ended. Released rows
-- are skipped, so history never blocks a new booking.
create or replace function app.guard_room_overlap()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room text;
  v_start date;
  v_end   date;
begin
  if new.released_at is not null then
    return new;
  end if;

  select r.room_number into v_room from public.rooms r where r.id = new.room_id;
  v_room := coalesce(v_room, 'unknown');

  v_start := coalesce(new.check_in_date, '-infinity'::date);
  v_end   := coalesce(new.check_out_date, 'infinity'::date);

  if v_end < v_start then
    raise exception 'Room % check-out % is before check-in %.', v_room, new.check_out_date, new.check_in_date
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.room_assignments ra
    where ra.room_id = new.room_id
      and ra.released_at is null
      and ra.id is distinct from new.id
      and daterange(coalesce(ra.check_in_date, '-infinity'::date), coalesce(ra.check_out_date, 'infinity'::date), '[)')
          && daterange(v_start, v_end, '[)')
  ) then
    raise exception 'Room % is already booked for an overlapping stay.', v_room
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists room_assignments_overlap on public.room_assignments;
create trigger room_assignments_overlap
  before insert or update on public.room_assignments
  for each row execute function app.guard_room_overlap();

-- Upgrade the occupancy guard to count against max_capacity.
create or replace function app.guard_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_max      integer;
  v_occupied integer;
  v_room     text;
begin
  if new.released_at is not null then
    return new;
  end if;

  select r.capacity, r.max_capacity, r.room_number into v_capacity, v_max, v_room
  from public.rooms r where r.id = new.room_id;

  -- max_capacity may be null on a row inserted before this migration ran
  -- the backfill — treat it as capacity rather than failing loudly.
  v_max := coalesce(v_max, v_capacity);

  select count(*) into v_occupied
  from public.room_assignments ra
  where ra.room_id = new.room_id
    and ra.released_at is null
    and ra.id is distinct from new.id;

  if v_occupied + 1 > v_max and not new.is_override then
    raise exception
      'Room % is at max capacity (max %, occupied %). Set is_override with a reason to force.',
      v_room, v_max, v_occupied
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists room_assignments_capacity on public.room_assignments;
create trigger room_assignments_capacity
  before insert or update on public.room_assignments
  for each row execute function app.guard_room_capacity();
