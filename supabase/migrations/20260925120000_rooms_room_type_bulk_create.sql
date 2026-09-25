-- =====================================================================
-- T4 - BULK ROOM CREATION
--
-- Two things:
--   1. rooms.room_type stops being free text. It is back-filled to
--      'standard' and constrained to the fixed vocabulary the UI offers
--      (suite, standard, deluxe, king, queen).
--   2. create_rooms_bulk() creates a contiguous run of numbered rooms in
--      one transaction, skipping numbers that already exist.
--
-- SECURITY INVOKER is deliberate: a DEFINER bulk insert would bypass the
-- rooms RLS insert policy and let one event write rooms into another.
--
-- rooms stays unique (hotel_id, room_number) - NOT (event_id, ...).
-- hotel_id is already event-fenced by the composite FK to
-- hotels (id, event_id), so that constraint is the one the "skip existing
-- numbers" check must match, and ON CONFLICT targets it exactly.
-- =====================================================================

-- 1. rooms.room_type becomes a constrained attribute ---------------------

-- The column already exists (plain text, from the 0300 baseline). NOT NULL is
-- deliberately NOT imposed: live call sites explicitly write a null room_type
-- for a room created without one, and the check below lets NULL through.
-- The default and the back-fill mean a type is present in practice; the UI
-- falls back to 'Standard' for any legacy NULL.
update public.rooms set room_type = 'standard' where room_type is null;

-- Fold case and whitespace, then fold anything outside the fixed vocabulary to
-- 'standard'. This is NOT hypothetical: two selects in the app offered 'Twin'
-- (no King, no Queen) and the importer's sample sheet ships a 'Twin' row, so a
-- live table can hold values the CHECK below would reject. Without this the
-- constraint would fail to apply on real data.
update public.rooms set room_type = lower(btrim(room_type)) where room_type is not null;
update public.rooms set room_type = 'standard'
 where room_type not in ('suite', 'standard', 'deluxe', 'king', 'queen');

alter table public.rooms alter column room_type set default 'standard';

alter table public.rooms drop constraint if exists rooms_room_type_check;
alter table public.rooms add constraint rooms_room_type_check
  check (room_type in ('suite', 'standard', 'deluxe', 'king', 'queen'));

create index if not exists rooms_event_room_type_idx
  on public.rooms (event_id, room_type);

comment on column public.rooms.room_type is
  'Fixed vocabulary: suite | standard | deluxe | king | queen. Defaults to standard.';

-- Trigger coverage is deliberately NOT re-asserted here. public.rooms is
-- already audit-covered by the 0300 baseline (which calls
-- app.attach_standard_triggers('public.rooms')), and that helper issues a bare
-- CREATE TRIGGER - no OR REPLACE, no DROP IF EXISTS - so it is a first-attach
-- helper and is NOT idempotent. Calling it again would abort this migration
-- with `trigger "rooms_audit" for relation "rooms" already exists` (42710) on
-- both the live database and a replayed clone. 0300 already attached
-- rooms_audit + rooms_touch and they must stay; nothing to do.
-- 2. Bulk create --------------------------------------------------------

create or replace function public.create_rooms_bulk(
  p_event_id     uuid,
  p_hotel_id     uuid,
  p_room_type    text,
  p_qty          integer,
  p_start_number integer,
  p_prefix       text    default '',
  p_capacity     integer default 2,
  p_max_capacity integer default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_candidates text[];
  v_created    text[];
  v_skipped    text[];
  v_capacity   integer := coalesce(p_capacity, 2);
  v_max        integer := coalesce(p_max_capacity, coalesce(p_capacity, 2) + 1);
begin
  -- app.is_staff() is `is_admin() or (jwt_event_id() = p_event_id and ...)`, so
  -- a caller with no event claim evaluates it to NULL, not false. `if not NULL`
  -- is NULL and plpgsql does not enter the branch, which would silently skip
  -- this guard; test `is not true` so NULL is treated as not-staff.
  if app.is_staff(p_event_id) is not true then
    raise exception 'Not permitted for event %.', p_event_id using errcode = '42501';
  end if;

  if p_qty is null or p_qty < 1 then
    raise exception 'Quantity must be at least 1.' using errcode = '22023';
  end if;
  if p_qty > 500 then
    raise exception 'Cannot create more than 500 rooms at once (asked for %).', p_qty
      using errcode = '22023';
  end if;

  if p_start_number is null or p_start_number < 0 then
    raise exception 'Starting room number must be zero or greater.' using errcode = '22023';
  end if;

  if p_room_type is null
     or p_room_type not in ('suite', 'standard', 'deluxe', 'king', 'queen') then
    raise exception 'Unknown room type "%".', p_room_type using errcode = '22023';
  end if;

  if v_capacity < 1 then
    raise exception 'Capacity must be at least 1.' using errcode = '22023';
  end if;

  if v_max < v_capacity then
    raise exception 'Max capacity (%) cannot be below capacity (%).', v_max, v_capacity
      using errcode = '22023';
  end if;

  -- The hotel must belong to this event. Redundant with RLS on purpose: it
  -- turns a silently-empty insert into a named error.
  if not exists (
    select 1 from public.hotels h
     where h.id = p_hotel_id
       and h.event_id = p_event_id
  ) then
    raise exception 'Hotel % does not belong to event %.', p_hotel_id, p_event_id
      using errcode = '23503';
  end if;
  v_candidates := array(
    select coalesce(p_prefix, '') || (p_start_number + gs - 1)::text
      from generate_series(1, p_qty) gs
  );

  -- ON CONFLICT matches unique (hotel_id, room_number) exactly: numbers that
  -- already exist are skipped, and a concurrent insert cannot raise 23505.
  with ins as (
    insert into public.rooms (
      event_id, hotel_id, room_number, room_type, capacity, max_capacity
    )
    select p_event_id, p_hotel_id, c, p_room_type, v_capacity, v_max
      from unnest(v_candidates) c
    on conflict (hotel_id, room_number) do nothing
    returning room_number
  )
  select coalesce(array_agg(room_number), '{}'::text[])
    into v_created
    from ins;

  select coalesce(array_agg(c order by c), '{}'::text[])
    into v_skipped
    from unnest(v_candidates) c
   where c <> all (coalesce(v_created, '{}'::text[]));

  return jsonb_build_object(
    'created', coalesce(array_length(v_created, 1), 0),
    'skipped', to_jsonb(coalesce(v_skipped, '{}'::text[]))
  );
end;
$$;

revoke all on function public.create_rooms_bulk(
  uuid, uuid, text, integer, integer, text, integer, integer
) from public;

grant execute on function public.create_rooms_bulk(
  uuid, uuid, text, integer, integer, text, integer, integer
) to authenticated;