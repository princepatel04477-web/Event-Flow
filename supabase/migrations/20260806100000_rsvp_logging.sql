-- =====================================================================
-- 1600 RSVP LOGGING (the outcome form)
--
-- The call screen records HOW a call went (outcome, duration). This adds
-- the structured RSVP record a caller types in after the call: adult and
-- child counts, arrival/departure details, needs_pickup, and the
-- multi-select special_requirements.
--
-- Design rules honoured here (see CLAUDE.md):
--   * The calling unit is the GROUP. Adults/children live on guest_groups.
--   * No enum invention: statuses and travel modes are the existing ones.
--   * Server clock only: no timestamp is ever set from application code;
--     created_at / updated_at / started_at all come from the DB.
--   * call_count is a single-writer counter: only the RSVP-logging trigger
--     below ever increments it, so it cannot drift the way an app-side
--     read-modify-write counter would. Attempts for display still come from
--     count(*) via v_rsvp_queue; call_count exists because the acceptance
--     spec asks for it and it is the one number the trigger owns.
--
-- IDEMPOTENCY: every statement is safe to re-run. Columns are added with
-- IF NOT EXISTS, functions with CREATE OR REPLACE, triggers with
-- DROP IF EXISTS + CREATE, views with CREATE OR REPLACE. This migration is
-- pushed repeatedly over a live database, including over partial state.
-- =====================================================================

alter table public.guest_groups
  add column if not exists adults_confirmed    integer check (adults_confirmed >= 0),
  add column if not exists children_confirmed  integer check (children_confirmed >= 0),
  add column if not exists needs_pickup        boolean not null default false,
  add column if not exists special_requirements text[] not null default '{}',
  add column if not exists call_count          integer not null default 0 check (call_count >= 0),
  add column if not exists callback_at         timestamptz;

comment on column public.guest_groups.adults_confirmed is
  'Adults this family confirmed over the phone. NULL = not asked yet.';
comment on column public.guest_groups.children_confirmed is
  'Children this family confirmed over the phone. NULL = not asked yet.';
comment on column public.guest_groups.confirmed_pax is
  'Total confirmed heads. Kept in sync with adults_confirmed + children_confirmed by app.sync_confirmed_pax().';
comment on column public.guest_groups.call_count is
  'Number of RSVP outcome logs written. Incremented ONLY by the rsvp_logged trigger (single writer, cannot drift).';
comment on column public.guest_groups.special_requirements is
  'Multi-select needs captured during the RSVP call: elderly, wheelchair, infant, dietary, medical.';
comment on column public.guest_groups.needs_pickup is
  'Family asked for an airport/station pickup. Drives vehicle suggestion (R4).';
comment on column public.guest_groups.callback_at is
  'When the family asked to be called back. Written by the RSVP outcome form when status = callback; feeds v_rsvp_queue.next_callback_at alongside call_attempts.callback_at.';

-- ---------------------------------------------------------------------
-- Keep confirmed_pax honest: adults + children, or NULL when unknown.
-- ---------------------------------------------------------------------
create or replace function app.sync_confirmed_pax()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.adults_confirmed is null and new.children_confirmed is null then
    new.confirmed_pax := null;
  else
    new.confirmed_pax := coalesce(new.adults_confirmed, 0) + coalesce(new.children_confirmed, 0);
  end if;
  return new;
end;
$$;

drop trigger if exists guest_groups_sync_confirmed_pax on public.guest_groups;
create trigger guest_groups_sync_confirmed_pax
  before insert or update of adults_confirmed, children_confirmed on public.guest_groups
  for each row execute function app.sync_confirmed_pax();

-- ---------------------------------------------------------------------
-- Count every RSVP outcome write. Single writer; the trigger owns the
-- counter so two phones finishing the same group can never race it.
--
-- UPDATE only. The Excel import INSERTs 238 groups with rsvp_status set;
-- an import is not a call, so it must not bump call_count. The trigger
-- fires on the status change, and counts once per distinct transition.
-- ---------------------------------------------------------------------
create or replace function app.count_rsvp_logged()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.rsvp_status is distinct from old.rsvp_status then
    update public.guest_groups
       set call_count = call_count + 1
     where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists guest_groups_rsvp_logged on public.guest_groups;
create trigger guest_groups_rsvp_logged
  after insert or update of rsvp_status on public.guest_groups
  for each row execute function app.count_rsvp_logged();

-- ---------------------------------------------------------------------
-- The queue's callback time now reads from EITHER the call screen's
-- call_attempts.callback_at (frozen with the attempt) OR the outcome
-- form's guest_groups.callback_at — whichever is set.
--
-- CREATE OR REPLACE VIEW cannot change a column's name or position in
-- place, and this view adds columns (adults_confirmed, children_confirmed)
-- ahead of rsvp_status, which shifts every downstream name. A plain
-- replace fails with 42P16. Dropping and recreating the view is safe — it
-- is a derived read, no data lives in it — and makes this idempotent.
-- ---------------------------------------------------------------------
drop view if exists public.v_rsvp_queue;
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
  gg.adults_confirmed,
  gg.children_confirmed,
  gg.rsvp_status,
  gg.priority,
  gg.remarks,
  gg.locked_by,
  gg.locked_until,
  (gg.locked_until is not null and gg.locked_until > now()) as is_locked,
  coalesce(c.attempts, 0)  as attempt_count,
  c.last_attempt_at,
  c.last_outcome,
  coalesce(gg.callback_at, c.next_callback_at) as next_callback_at
from public.guest_groups gg
left join lateral (
  select
    count(*)                                          as attempts,
    max(ca.started_at)                                as last_attempt_at,
    (array_agg(ca.outcome order by ca.started_at desc))[1] as last_outcome,
    min(ca.callback_at) filter (where ca.callback_at > now()) as next_callback_at
  from public.call_attempts ca
  where ca.group_id = gg.id
) c on true;

-- The drop above wiped the view's privileges; re-grant like migration 0600.
grant select on public.v_rsvp_queue to authenticated;

-- ---------------------------------------------------------------------
-- The ONE write path for the outcome form. Runs in a single transaction:
-- guest_groups (status, counts, pickup, requirements, notes, lock release)
-- plus the arrival/departure travel legs. Mirrors apply_rsvp_extraction()
-- in shape: coalesce on the leg fields, server timestamps, lock cleared.
-- ---------------------------------------------------------------------
create or replace function public.save_rsvp_log(
  p_event_id        uuid,
  p_group_id        uuid,
  p_rsvp_status     app.rsvp_status,
  p_adults_confirmed integer,
  p_children_confirmed integer,
  p_needs_pickup    boolean,
  p_special_requirements text[],
  p_callback_at     timestamptz,
  p_notes           text,
  p_arrival         jsonb,
  p_departure       jsonb
)
returns public.guest_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.guest_groups;
begin
  -- Fence on the group's OWN event (claim_group() semantics): a foreign
  -- group id must not be reachable through this event's lock.
  if not exists (
    select 1 from public.guest_groups g
    where g.id = p_group_id and g.event_id = p_event_id
  ) then
    raise exception 'Group % not found in this event.', p_group_id
      using errcode = '55P03';  -- lock_not_available, matching claim_group()
  end if;

  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  -- Lock ownership guard, matching claim_group()'s re-entrancy rules: the
  -- caller may save only when they hold the lock, the lock has expired, or
  -- the group was never locked. A save from a caller whose lock was taken
  -- over is rejected — otherwise two phones could overwrite each other's
  -- RSVP for the same family. Rows are re-read so the honest case (already
  -- released) is told apart from "someone else holds it".
  select g.* into v_group
    from public.guest_groups g
   where g.id = p_group_id;

  if v_group.locked_by is not null
     and v_group.locked_by <> auth.uid()
     and v_group.locked_until is not null
     and v_group.locked_until > now() then
    raise exception 'This family is locked by another caller right now.'
      using errcode = '55P03';
  end if;

  -- The head count + status + travel + lock release, one statement. The
  -- adults/children sync trigger keeps confirmed_pax consistent; the
  -- rsvp_logged trigger bumps call_count when the status actually changes.
  -- callback_at on guest_groups is set for a callback outcome and cleared
  -- for any other status, so a stale booking never lingers.
  update public.guest_groups g
     set rsvp_status          = p_rsvp_status,
         adults_confirmed     = p_adults_confirmed,
         children_confirmed   = p_children_confirmed,
         needs_pickup         = coalesce(p_needs_pickup, g.needs_pickup),
         special_requirements = case
                                  when p_special_requirements is null then g.special_requirements
                                  else p_special_requirements
                                end,
         remarks              = coalesce(p_notes, g.remarks),
         callback_at          = case
                                  when p_rsvp_status = 'callback' then p_callback_at
                                  else null
                                end,
         locked_by            = null,
         locked_until         = null,
         updated_at           = now()
   where g.id = p_group_id
  returning * into v_group;

  if v_group.id is null then
    raise exception 'Group % could not be updated.', p_group_id
      using errcode = '42501';
  end if;

  -- Upsert one leg per direction (the codebase's own rule: the RPCs only
  -- ever address the single leg per direction).
  if p_arrival is not null and jsonb_typeof(p_arrival) = 'object' then
    perform public.upsert_rsvp_leg(p_event_id, p_group_id, 'arrival', p_arrival);
  end if;
  if p_departure is not null and jsonb_typeof(p_departure) = 'object' then
    perform public.upsert_rsvp_leg(p_event_id, p_group_id, 'departure', p_departure);
  end if;

  return v_group;
end;
$$;

-- ---------------------------------------------------------------------
-- Insert-or-update one travel leg. coerce()/nullif() keep "blank" from
-- writing an empty string; coalesce() leaves untouched values alone.
-- needs_transport defaults true (the column's default) on insert.
-- ---------------------------------------------------------------------
create or replace function public.upsert_rsvp_leg(
  p_event_id uuid,
  p_group_id uuid,
  p_direction app.travel_direction,
  p_leg jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leg_id uuid;
begin
  select tl.id into v_leg_id
    from public.travel_legs tl
   where tl.group_id = p_group_id and tl.direction = p_direction
   order by tl.created_at
   limit 1;

  if v_leg_id is null then
    insert into public.travel_legs (
      event_id, group_id, direction, mode, travel_date, travel_time,
      reference, point, source
    ) values (
      p_event_id, p_group_id, p_direction,
      nullif(p_leg ->> 'mode', '')::app.travel_mode,
      nullif(p_leg ->> 'date', '')::date,
      nullif(p_leg ->> 'time', '')::time,
      nullif(p_leg ->> 'reference', ''),
      nullif(p_leg ->> 'point', ''),
      'rsvp_call'
    );
  else
    update public.travel_legs tl
       set mode        = coalesce(nullif(p_leg ->> 'mode', '')::app.travel_mode, tl.mode),
           travel_date = coalesce(nullif(p_leg ->> 'date', '')::date, tl.travel_date),
           travel_time = coalesce(nullif(p_leg ->> 'time', '')::time, tl.travel_time),
           reference   = coalesce(nullif(p_leg ->> 'reference', ''), tl.reference),
           point       = coalesce(nullif(p_leg ->> 'point', ''), tl.point),
           updated_at  = now()
     where tl.id = v_leg_id;
  end if;
end;
$$;

grant execute on function public.save_rsvp_log(uuid, uuid, app.rsvp_status, integer, integer, boolean, text[], timestamptz, text, jsonb, jsonb),
                    public.upsert_rsvp_leg(uuid, uuid, app.travel_direction, jsonb)
  to authenticated;
