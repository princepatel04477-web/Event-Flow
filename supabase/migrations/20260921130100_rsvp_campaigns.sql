-- =====================================================================
-- RSVP outbound campaigns — three calling waves per event.
-- Jobs are per family (guest_group); status is derived from attempts,
-- not a stored counter on the group.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'rsvp_campaign_wave' and typnamespace = 'app'::regnamespace) then
    create type app.rsvp_campaign_wave as enum ('wave_1', 'wave_2', 'wave_3');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'rsvp_campaign_status' and typnamespace = 'app'::regnamespace) then
    create type app.rsvp_campaign_status as enum (
      'draft', 'scheduled', 'running', 'paused', 'completed'
    );
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'rsvp_job_status' and typnamespace = 'app'::regnamespace) then
    create type app.rsvp_job_status as enum (
      'pending', 'ringing', 'completed', 'no_answer', 'declined',
      'failed', 'dnd', 'skipped', 'callback'
    );
  end if;
end $$;

create table if not exists public.rsvp_campaigns (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events (id) on delete cascade,
  wave            app.rsvp_campaign_wave not null,
  label           text not null,
  scheduled_for   date,
  status          app.rsvp_campaign_status not null default 'draft',
  max_concurrent  integer not null default 2 check (max_concurrent between 1 and 10),
  days_before     integer not null check (days_before >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (event_id, wave),
  unique (id, event_id)
);

create index if not exists rsvp_campaigns_event_status_idx
  on public.rsvp_campaigns (event_id, status);

comment on table public.rsvp_campaigns is
  'One row per calling wave (typically 30 / 10 / 2 days before the wedding). '
  'Managers start, pause, and complete campaigns from the RSVP screen.';

create table if not exists public.rsvp_campaign_jobs (
  id                  uuid primary key default gen_random_uuid(),
  campaign_id         uuid not null,
  event_id            uuid not null references public.events (id) on delete cascade,
  group_id            uuid not null,
  status              app.rsvp_job_status not null default 'pending',
  call_attempt_id     uuid references public.call_attempts (id),
  call_recording_id   uuid references public.call_recordings (id),
  extraction_id       uuid references public.rsvp_extractions (id),
  dial_attempts       integer not null default 0 check (dial_attempts >= 0),
  last_dialed_at      timestamptz,
  completed_at        timestamptz,
  error_text          text,
  agent_notes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (campaign_id, group_id),
  unique (id, event_id),
  foreign key (campaign_id, event_id)
    references public.rsvp_campaigns (id, event_id) on delete cascade,
  foreign key (group_id, event_id)
    references public.guest_groups (id, event_id) on delete cascade
);

create index if not exists rsvp_campaign_jobs_campaign_status_idx
  on public.rsvp_campaign_jobs (campaign_id, status);
create index if not exists rsvp_campaign_jobs_event_group_idx
  on public.rsvp_campaign_jobs (event_id, group_id);

select app.attach_standard_triggers('public.rsvp_campaigns');
select app.attach_standard_triggers('public.rsvp_campaign_jobs');

-- RLS: staff on the event only.
select app.apply_staff_policies('rsvp_campaigns');
select app.apply_staff_policies('rsvp_campaign_jobs');
