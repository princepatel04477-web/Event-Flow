-- =====================================================================
-- 0300 ROOMS + HAMPERS + RETURN GIFTS
-- =====================================================================

create table if not exists public.hotels (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  name            text not null,
  address         text,
  contact_name    text,
  contact_mobile  text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, event_id),
  unique (event_id, name)
);

create table if not exists public.rooms (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  hotel_id     uuid not null,
  room_number  text not null,
  room_type    text,                                  -- Deluxe / Suite / Twin
  capacity     integer not null check (capacity > 0), -- client gives this
  floor        text,
  is_blocked   boolean not null default false,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, event_id),
  unique (hotel_id, room_number),
  foreign key (hotel_id, event_id)
    references public.hotels (id, event_id) on delete cascade
);

create index if not exists rooms_event_hotel_idx on public.rooms (event_id, hotel_id);

-- ---------------------------------------------------------------------
-- ROOM ASSIGNMENTS
-- One row per guest per stay. Released rows stay for history, so a room
-- swap on the day is fully traceable. Two singles sharing = two rows
-- pointing at the same room_id. Auto-allocate first, manual always wins.
-- ---------------------------------------------------------------------

create table if not exists public.room_assignments (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  room_id         uuid not null,
  guest_id        uuid not null,
  group_id        uuid not null,

  check_in_date   date,
  check_in_time   time,
  check_out_date  date,
  check_out_time  time,

  is_override     boolean not null default false,   -- bypass capacity, needs reason
  override_reason text,
  assigned_by     uuid references auth.users (id) default auth.uid(),
  assigned_at     timestamptz not null default now(),
  released_at     timestamptz,
  release_reason  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  foreign key (room_id, event_id)  references public.rooms (id, event_id) on delete cascade,
  foreign key (guest_id, event_id) references public.guests (id, event_id) on delete cascade,
  foreign key (group_id, event_id) references public.guest_groups (id, event_id) on delete cascade,
  check (not is_override or override_reason is not null)
);

create unique index if not exists room_assignments_one_active_per_guest
  on public.room_assignments (guest_id) where released_at is null;

create index if not exists room_assignments_active_by_room
  on public.room_assignments (event_id, room_id) where released_at is null;

-- Refuse to overfill a room unless someone explicitly overrides with a reason.
create or replace function app.guard_room_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_occupied integer;
  v_room     text;
begin
  if new.released_at is not null then
    return new;
  end if;

  select r.capacity, r.room_number into v_capacity, v_room
  from public.rooms r where r.id = new.room_id;

  select count(*) into v_occupied
  from public.room_assignments ra
  where ra.room_id = new.room_id
    and ra.released_at is null
    and ra.id is distinct from new.id;

  if v_occupied + 1 > v_capacity and not new.is_override then
    raise exception
      'Room % is full (capacity %, occupied %). Set is_override with a reason to force.',
      v_room, v_capacity, v_occupied
      using errcode = '23514';
  end if;

  return new;
end;
$$;

drop trigger if exists room_assignments_capacity on public.room_assignments;
create trigger room_assignments_capacity
  before insert or update on public.room_assignments
  for each row execute function app.guard_room_capacity();

-- ---------------------------------------------------------------------
-- DELIVERABLES — hampers and return gifts share one table.
-- Return gift is special-guests-only, so rows are simply not created
-- for groups where needs_return_gift is false.
-- ---------------------------------------------------------------------

create table if not exists public.deliverables (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  kind         app.deliverable_kind not null,
  group_id     uuid not null,
  guest_id     uuid,
  room_id      uuid,

  item_name    text,
  quantity     integer not null default 1 check (quantity > 0),
  status       app.deliverable_status not null default 'pending',
  assigned_to  uuid references auth.users (id),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  unique (id, event_id),
  foreign key (group_id, event_id) references public.guest_groups (id, event_id) on delete cascade,
  foreign key (guest_id, event_id) references public.guests (id, event_id) on delete set null,
  foreign key (room_id,  event_id) references public.rooms  (id, event_id) on delete set null
);

create index if not exists deliverables_event_kind_status_idx on public.deliverables (event_id, kind, status);
create index if not exists deliverables_event_room_idx on public.deliverables (event_id, room_id);
create unique index if not exists deliverables_one_per_group_kind
  on public.deliverables (group_id, kind) where guest_id is null;

-- ---------------------------------------------------------------------
-- DELIVERY PROOFS — the whole point of the app.
-- INSERT ONLY. No update, no delete, at trigger AND grant AND policy level.
-- recorded_at is overwritten with the server clock on every insert, so a
-- phone with a fiddled clock cannot backdate a photo.
-- ---------------------------------------------------------------------

create table if not exists public.delivery_proofs (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events (id) on delete restrict,
  deliverable_id     uuid not null references public.deliverables (id) on delete restrict,

  storage_bucket     text not null default 'delivery-proofs',
  storage_path       text not null,
  photo_sha256       text,
  file_size_bytes    bigint,

  captured_by        uuid not null default auth.uid() references auth.users (id),
  device_captured_at timestamptz,                        -- phone clock, untrusted
  recorded_at        timestamptz not null default now(), -- SERVER clock, the one that counts

  latitude           numeric(9,6),
  longitude          numeric(9,6),
  received_by_name   text,
  notes              text
);

create index if not exists delivery_proofs_event_recorded_idx on public.delivery_proofs (event_id, recorded_at desc);
create index if not exists delivery_proofs_deliverable_idx on public.delivery_proofs (deliverable_id);

drop trigger if exists delivery_proofs_server_clock on public.delivery_proofs;
create trigger delivery_proofs_server_clock
  before insert on public.delivery_proofs
  for each row execute function app.force_server_recorded_at();

drop trigger if exists delivery_proofs_no_update on public.delivery_proofs;
create trigger delivery_proofs_no_update
  before update on public.delivery_proofs
  for each row execute function app.block_mutation();

drop trigger if exists delivery_proofs_no_delete on public.delivery_proofs;
create trigger delivery_proofs_no_delete
  before delete on public.delivery_proofs
  for each row execute function app.block_mutation();

-- A proof photo flips the parent to delivered. Nothing else may.
create or replace function app.mark_deliverable_delivered()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.deliverables
     set status = 'delivered', updated_at = now()
   where id = new.deliverable_id
     and status <> 'delivered';
  return new;
end;
$$;

drop trigger if exists delivery_proofs_mark_delivered on public.delivery_proofs;
create trigger delivery_proofs_mark_delivered
  after insert on public.delivery_proofs
  for each row execute function app.mark_deliverable_delivered();

select app.attach_standard_triggers('public.hotels');
select app.attach_standard_triggers('public.rooms');
select app.attach_standard_triggers('public.room_assignments');
select app.attach_standard_triggers('public.deliverables');

-- delivery_proofs gets audit on insert only (update/delete are impossible)
drop trigger if exists delivery_proofs_audit on public.delivery_proofs;
create trigger delivery_proofs_audit
  after insert on public.delivery_proofs
  for each row execute function app.audit_trigger();
