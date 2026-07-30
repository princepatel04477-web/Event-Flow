-- =====================================================================
-- 0400 LOGISTICS + MESSAGING + EXCEL IMPORT
-- =====================================================================

-- ---------------------------------------------------------------------
-- VEHICLE TYPES
-- event_id NULL  = global template (seed data, capacities you gave me)
-- event_id SET   = this event's own type, editable by the team
-- default_capacity is PAX WITH LUGGAGE, not the sticker seat count.
-- ---------------------------------------------------------------------

create table public.vehicle_types (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid references public.events (id) on delete cascade,
  name              text not null,
  seat_label        text,                                        -- "20-seater"
  default_capacity  integer not null check (default_capacity > 0),
  sort_order        integer not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (id, event_id)
);

create unique index vehicle_types_global_name_uq
  on public.vehicle_types (name) where event_id is null;
create unique index vehicle_types_event_name_uq
  on public.vehicle_types (event_id, name) where event_id is not null;

comment on column public.vehicle_types.default_capacity is
  'People carried WITH luggage. A 20-seater traveller is 17 in real life.';

-- ---------------------------------------------------------------------
-- VEHICLES — the actual fleet on the day, entered by the event team.
-- Never hardcoded: every event has a different set of cars.
-- ---------------------------------------------------------------------

create table public.vehicles (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  vehicle_type_id  uuid references public.vehicle_types (id) on delete set null,
  label            text,                                    -- "Innova #2"
  registration_no  text,
  capacity         integer not null check (capacity > 0),   -- seeded from type, editable
  driver_name      text,
  driver_mobile    text,
  vendor_name      text,
  rate_note        text,
  status           app.vehicle_status not null default 'available',
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (id, event_id)
);

create index on public.vehicles (event_id, status);

-- ---------------------------------------------------------------------
-- TRIPS + PASSENGERS
-- ---------------------------------------------------------------------

create table public.trips (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  vehicle_id      uuid,
  direction       app.travel_direction not null,

  scheduled_at    timestamptz,
  pickup_point    text,
  drop_point      text,
  driver_name     text,
  driver_mobile   text,

  status          app.trip_status not null default 'planned',
  seats_capacity  integer,
  seats_used      integer not null default 0 check (seats_used >= 0),

  expense_amount  numeric(10,2) check (expense_amount >= 0),   -- rupees, cab cost
  expense_mode    text,                                        -- cash / upi / vendor bill
  expense_notes   text,

  created_by      uuid references auth.users (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (id, event_id),
  foreign key (vehicle_id, event_id)
    references public.vehicles (id, event_id) on delete set null
);

create index on public.trips (event_id, direction, scheduled_at);
create index on public.trips (event_id, status);

create table public.trip_passengers (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  trip_id        uuid not null,
  group_id       uuid not null,
  travel_leg_id  uuid,
  pax            integer not null check (pax > 0),
  created_at     timestamptz not null default now(),

  foreign key (trip_id,  event_id) references public.trips (id, event_id) on delete cascade,
  foreign key (group_id, event_id) references public.guest_groups (id, event_id) on delete cascade,
  foreign key (travel_leg_id, event_id)
    references public.travel_legs (id, event_id) on delete set null
);

create unique index trip_passengers_leg_uq
  on public.trip_passengers (travel_leg_id) where travel_leg_id is not null;
create index on public.trip_passengers (trip_id);

-- Keep trips.seats_used honest without the app having to remember.
create or replace function app.recount_trip_seats()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trip uuid := coalesce(new.trip_id, old.trip_id);
begin
  update public.trips t
     set seats_used = coalesce((
           select sum(tp.pax) from public.trip_passengers tp where tp.trip_id = v_trip
         ), 0),
         updated_at = now()
   where t.id = v_trip;
  return coalesce(new, old);
end;
$$;

create trigger trip_passengers_recount
  after insert or update or delete on public.trip_passengers
  for each row execute function app.recount_trip_seats();

-- ---------------------------------------------------------------------
-- WHATSAPP MESSAGING
-- ---------------------------------------------------------------------

create table public.message_templates (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.events (id) on delete cascade,  -- null = global
  key         text not null,               -- rsvp_invite, room_allocated, ...
  category    text,
  language    text not null default 'en',
  body        text not null,               -- {{head_name}} style placeholders
  variables   jsonb not null default '[]'::jsonb,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index message_templates_global_uq
  on public.message_templates (key, language) where event_id is null;
create unique index message_templates_event_uq
  on public.message_templates (event_id, key, language) where event_id is not null;

create table public.messages (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events (id) on delete cascade,
  group_id            uuid,
  guest_id            uuid,
  to_number           text not null,
  template_key        text,
  body                text not null,
  provider            text,                         -- meta_cloud | self_hosted
  provider_message_id text,
  status              app.message_status not null default 'queued',
  error               text,
  queued_at           timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  read_at             timestamptz,
  created_by          uuid references auth.users (id) default auth.uid(),

  foreign key (group_id, event_id) references public.guest_groups (id, event_id) on delete set null,
  foreign key (guest_id, event_id) references public.guests (id, event_id) on delete set null
);

create index on public.messages (event_id, status, queued_at desc);
create index on public.messages (event_id, group_id);
create index on public.messages (provider_message_id);

-- ---------------------------------------------------------------------
-- EXCEL IMPORT — idempotent by row_hash
-- ---------------------------------------------------------------------

create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  kind          text not null,                 -- guests | rooms | rsvp | logistics
  filename      text,
  storage_path  text,
  total_rows    integer,
  inserted_rows integer not null default 0,
  updated_rows  integer not null default 0,
  skipped_rows  integer not null default 0,
  status        text not null default 'pending',
  error         text,
  imported_by   uuid references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

create table public.import_rows (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  batch_id    uuid not null references public.import_batches (id) on delete cascade,
  row_number  integer not null,
  raw         jsonb not null,
  row_hash    text not null,
  status      text not null default 'pending', -- inserted | updated | skipped | error
  error       text,
  group_id    uuid,
  created_at  timestamptz not null default now(),

  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete set null
);

create index on public.import_rows (batch_id, row_number);
create index on public.import_rows (event_id, row_hash);

select app.attach_standard_triggers('public.vehicle_types');
select app.attach_standard_triggers('public.vehicles');
select app.attach_standard_triggers('public.trips');
select app.attach_standard_triggers('public.message_templates');
