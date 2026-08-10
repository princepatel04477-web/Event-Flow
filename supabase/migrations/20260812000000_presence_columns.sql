-- =====================================================================
-- guest_groups: add soft presence columns (H3 alternative)
-- =====================================================================
-- Caller-lock RPCs (claim_group / release_group / locked_by / locked_until)
-- were removed from the call path on 2026-08-12. They still exist in the DB
-- but are dormant — see CLAUDE.md §6.
--
-- These columns replace the lock with non-blocking presence:
--   last_opened_by_staff  — the most recent caller to open this group
--   last_opened_at        — when they opened it (SERVER clock, not client)
--
-- Fire-and-forget on navigation; never awaited, never fails, never shown as
-- an error. Rendered on the queue row as quiet text ("Ravi, 2 min ago")
-- when within the last 15 minutes. Informational only. Row stays tappable.
-- =====================================================================

alter table public.guest_groups
  add column if not exists last_opened_by_staff
    uuid references public.staff_members (id) on delete set null,
  add column if not exists last_opened_at
    timestamptz;

comment on column public.guest_groups.last_opened_by_staff is
  'Most recent caller to open this group''s call screen. Fire-and-forget — '
  'never blocked on, never surfaced as an error. Used only by the queue ''s '
  '"Ravi, 2 min ago" labelling.';

comment on column public.guest_groups.last_opened_at is
  'Server time of the most recent call-screen open. STAMPED BY TRIGGER, so '
  'the client cannot lie about it.';

create index if not exists guest_groups_last_opened_idx
  on public.guest_groups (event_id, last_opened_at desc nulls last)
  where last_opened_at is not null;

-- Force last_opened_at to be the server clock, same as delivery_proofs.
create or replace function app.force_server_last_opened()
returns trigger
language plpgsql
as $$
begin
  new.last_opened_at := now();
  return new;
end;
$$;

drop trigger if exists guest_groups_presence_clock on public.guest_groups;
create trigger guest_groups_presence_clock
  before update of last_opened_by_staff on public.guest_groups
  for each row
  execute function app.force_server_last_opened();

-- ---------------------------------------------------------------------------
-- Update the v_rsvp_queue view to include presence columns for the queue UI.
-- Only a left join — presence is optional and never gates access.
-- Drop and recreate: the live view and the migration file have diverged
-- (locked_by_staff was added to the live view by a later migration), so
-- create-or-replace with missing columns fails.
-- ---------------------------------------------------------------------------
drop view if exists public.v_rsvp_queue cascade;

create view public.v_rsvp_queue
with (security_invoker = true) as
select
  gg.id            as group_id,
  gg.event_id,
  gg.head_name,
  gg.primary_mobile,
  gg.group_type,
  gg.side,
  gg.expected_pax,
  gg.confirmed_pax,
  gg.rsvp_status,
  gg.priority,
  gg.remarks,
  gg.locked_by,
  gg.locked_until,
  (gg.locked_until is not null and gg.locked_until > now()) as is_locked,
  coalesce(c.attempts, 0)  as attempt_count,
  c.last_attempt_at,
  c.last_outcome,
  c.next_callback_at,
  -- Soft presence (2026-08-12): non-blocking caller-visible signal
  gg.last_opened_by_staff,
  gg.last_opened_at,
  sm.full_name as last_opened_by_name
from public.guest_groups gg
left join lateral (
  select
    count(*)                                          as attempts,
    max(ca.started_at)                                as last_attempt_at,
    (array_agg(ca.outcome order by ca.started_at desc))[1] as last_outcome,
    min(ca.callback_at) filter (where ca.callback_at > now()) as next_callback_at
  from public.call_attempts ca
  where ca.group_id = gg.id
) c on true
left join public.staff_members sm
  on sm.id = gg.last_opened_by_staff;

grant select on public.v_rsvp_queue to authenticated;
