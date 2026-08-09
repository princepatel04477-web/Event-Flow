-- =====================================================================
-- 0200 GUESTS + RSVP  (Phase 1)
-- The calling unit is the GROUP (family head), not the individual guest.
-- You dial one number and the head answers for everybody.
-- =====================================================================

create table if not exists public.guest_groups (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,

  group_code      text,                       -- value from the Excel grouping column
  head_name       text not null,
  primary_mobile  text,                       -- store normalised: 10 digits, no +91
  alt_mobile      text,
  side            app.side,
  group_type      app.group_type not null default 'family',
  city            text,

  expected_pax    integer not null default 1 check (expected_pax >= 0),
  confirmed_pax   integer check (confirmed_pax >= 0),
  rsvp_status     app.rsvp_status not null default 'not_started',

  needs_return_gift boolean not null default false,   -- return gift = special guests only
  priority        integer not null default 0,          -- higher = call first
  remarks         text,

  -- caller concurrency lock: stops two callers dialling the same uncle
  locked_by       uuid references auth.users (id),
  locked_until    timestamptz,

  source_row_hash text,                        -- idempotent Excel re-import key
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (id, event_id)                        -- target for composite child FKs
);

create unique index if not exists guest_groups_event_row_hash_uq
  on public.guest_groups (event_id, source_row_hash)
  where source_row_hash is not null;

create index if not exists guest_groups_event_status_idx on public.guest_groups (event_id, rsvp_status);
create index if not exists guest_groups_event_mobile_idx on public.guest_groups (event_id, primary_mobile);
create index if not exists guest_groups_event_priority_idx on public.guest_groups (event_id, priority desc);

comment on column public.guest_groups.source_row_hash is
  'Hash of the identifying Excel cells. Makes re-importing the same sheet a no-op '
  'instead of creating 238 duplicates.';

-- ---------------------------------------------------------------------

create table if not exists public.guests (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.events (id) on delete cascade,
  group_id    uuid not null,
  full_name   text not null,
  mobile      text,
  is_head     boolean not null default false,
  age_band    app.age_band not null default 'adult',
  notes       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (id, event_id),
  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete cascade
);

create index if not exists guests_event_group_idx on public.guests (event_id, group_id);
create unique index if not exists guests_single_head_per_group
  on public.guests (group_id) where is_head;

-- ---------------------------------------------------------------------
-- TRAVEL LEGS — arrival and departure live in the same table so that
-- "LHS = RHS" is a single query: every arrival leg needs a departure leg.
-- ---------------------------------------------------------------------

create table if not exists public.travel_legs (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  group_id        uuid not null,

  direction       app.travel_direction not null,
  mode            app.travel_mode,
  travel_date     date,
  travel_time     time,
  reference       text,                 -- flight no / train no / PNR
  point           text,                 -- airport, station, pickup or drop location
  pax_on_leg      integer check (pax_on_leg >= 0),
  needs_transport boolean not null default true,

  source          app.data_source not null default 'rsvp_call',
  notes           text,
  created_by      uuid references auth.users (id) default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  unique (id, event_id),
  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete cascade
);

create index if not exists travel_legs_event_direction_idx on public.travel_legs (event_id, direction, travel_date, travel_time);
create index if not exists travel_legs_event_group_direction_idx on public.travel_legs (event_id, group_id, direction);

-- ---------------------------------------------------------------------
-- CALL ATTEMPTS — append-only. Attempt count is count(*), never a stored
-- counter (stored counters drift the moment two devices are offline).
-- ---------------------------------------------------------------------

create table if not exists public.call_attempts (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.events (id) on delete cascade,
  group_id       uuid not null,

  caller_id      uuid not null default auth.uid() references auth.users (id),
  dialed_number  text not null,

  started_at     timestamptz not null default now(),   -- SERVER clock
  ended_at       timestamptz,
  duration_sec   integer check (duration_sec >= 0),

  outcome        app.call_outcome,
  callback_at    timestamptz,
  notes          text,
  finalized_at   timestamptz,

  device_started_at timestamptz,      -- phone clock, reference only, untrusted

  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete cascade
);

create index if not exists call_attempts_event_group_idx on public.call_attempts (event_id, group_id, started_at desc);
create index if not exists call_attempts_event_caller_idx on public.call_attempts (event_id, caller_id, started_at desc);
create index if not exists call_attempts_event_outcome_idx on public.call_attempts (event_id, outcome);

-- Rows may be completed once (ended_at / outcome), then they freeze.
-- Identity columns can never be changed. Deletes are never allowed.
create or replace function app.guard_call_attempt()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'call_attempts is append-only; delete is not permitted.'
      using errcode = '42501';
  end if;

  if old.finalized_at is not null then
    raise exception 'Call attempt % is finalized and cannot be edited.', old.id
      using errcode = '42501';
  end if;

  new.id            := old.id;
  new.event_id      := old.event_id;
  new.group_id      := old.group_id;
  new.caller_id     := old.caller_id;
  new.dialed_number := old.dialed_number;
  new.started_at    := old.started_at;

  if new.outcome is not null and old.outcome is null then
    new.finalized_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists call_attempts_guard_update on public.call_attempts;
create trigger call_attempts_guard_update
  before update on public.call_attempts
  for each row execute function app.guard_call_attempt();

drop trigger if exists call_attempts_guard_delete on public.call_attempts;
create trigger call_attempts_guard_delete
  before delete on public.call_attempts
  for each row execute function app.guard_call_attempt();

-- Server-stamp started_at on insert regardless of what the phone sends.
create or replace function app.force_server_started_at()
returns trigger
language plpgsql
as $$
begin
  new.device_started_at := new.started_at;
  new.started_at := now();
  return new;
end;
$$;

drop trigger if exists call_attempts_server_clock on public.call_attempts;
create trigger call_attempts_server_clock
  before insert on public.call_attempts
  for each row execute function app.force_server_started_at();

-- ---------------------------------------------------------------------
-- RECORDINGS -> TRANSCRIPT -> EXTRACTION -> HUMAN REVIEW -> COMMIT
-- Nothing in this chain writes to guest_groups on its own. Only a
-- reviewed, accepted extraction becomes data (see 0600 apply_rsvp_extraction).
-- ---------------------------------------------------------------------

create table if not exists public.call_recordings (
  id                 uuid primary key default gen_random_uuid(),
  event_id           uuid not null references public.events (id) on delete cascade,
  call_attempt_id    uuid references public.call_attempts (id) on delete cascade,
  group_id           uuid,

  storage_bucket     text not null default 'call-recordings',
  storage_path       text not null unique,
  duration_sec       integer,
  file_size_bytes    bigint,
  mime_type          text,
  sha256             text,

  device_captured_at timestamptz,                        -- untrusted
  recorded_at        timestamptz not null default now(), -- SERVER clock
  uploaded_by        uuid references auth.users (id) default auth.uid(),

  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete set null
);

create index if not exists call_recordings_event_idx on public.call_recordings (event_id, recorded_at desc);

drop trigger if exists call_recordings_server_clock on public.call_recordings;
create trigger call_recordings_server_clock
  before insert on public.call_recordings
  for each row execute function app.force_server_recorded_at();

create table if not exists public.transcripts (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  recording_id  uuid not null references public.call_recordings (id) on delete cascade,
  text          text not null,
  language      text,                 -- gu-IN / hi-IN / en-IN
  provider      text,
  model         text,
  confidence    numeric(4,3),
  created_at    timestamptz not null default now()
);

create index if not exists transcripts_event_recording_idx on public.transcripts (event_id, recording_id);

create table if not exists public.rsvp_extractions (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  group_id         uuid not null,
  transcript_id    uuid references public.transcripts (id) on delete set null,
  call_attempt_id  uuid references public.call_attempts (id) on delete set null,

  parsed           jsonb not null,                 -- structured RSVP payload
  confidence       jsonb not null default '{}'::jsonb,
  model            text,

  status           app.extraction_status not null default 'pending',
  reviewed_by      uuid references auth.users (id),
  reviewed_at      timestamptz,
  applied_at       timestamptz,
  review_notes     text,
  created_at       timestamptz not null default now(),

  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete cascade
);

create index if not exists rsvp_extractions_event_status_idx on public.rsvp_extractions (event_id, status, created_at desc);
create index if not exists rsvp_extractions_event_group_idx on public.rsvp_extractions (event_id, group_id);

comment on table public.rsvp_extractions is
  'AI output is EVIDENCE, not data. A row here changes nothing until a human '
  'accepts it and app.apply_rsvp_extraction() commits it.';

select app.attach_standard_triggers('public.guest_groups');
select app.attach_standard_triggers('public.guests');
select app.attach_standard_triggers('public.travel_legs');
select app.attach_standard_triggers('public.call_attempts');
select app.attach_standard_triggers('public.call_recordings');
select app.attach_standard_triggers('public.rsvp_extractions');
