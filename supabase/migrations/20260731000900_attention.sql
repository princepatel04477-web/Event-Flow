-- 0900 ATTENTION VIEW + MANUAL MESSAGE PROVIDER ENUM
-- ---------------------------------------------------------------------
-- v_event_attention
-- One row per event. Every counter is 0 when nothing needs doing.
-- Runs as the caller (security_invoker = true), so RLS keeps non-staff
-- users seeing honest zeros.
-- ---------------------------------------------------------------------

create or replace view public.v_event_attention
with (security_invoker = true) as
select
  e.id as event_id,

  -- Confirmed families with no active room assignment
  coalesce((
    select count(*)
    from public.guest_groups g
    where g.event_id = e.id
      and g.rsvp_status = 'confirmed'
      and not exists (
        select 1
        from public.room_assignments ra
        where ra.group_id = g.id
          and ra.released_at is null
      )
  ), 0) as confirmed_no_room,

  -- Arrivals today where no vehicle (trip) has been assigned to this group
  coalesce((
    select count(distinct g.id)
    from public.travel_legs tl
    join public.guest_groups g
      on g.id = tl.group_id and g.event_id = tl.event_id
    where tl.event_id = e.id
      and tl.direction = 'arrival'
      and tl.travel_date = current_date
      and not exists (
        select 1
        from public.trip_passengers tp
        join public.trips t
          on t.id = tp.trip_id and t.event_id = tp.event_id
        where tp.group_id = g.id
          and t.direction = 'arrival'
      )
  ), 0) as arrivals_no_vehicle,

  -- Confirmed families with no departure leg recorded
  coalesce((
    select count(*)
    from public.guest_groups g
    where g.event_id = e.id
      and g.rsvp_status = 'confirmed'
      and not exists (
        select 1
        from public.travel_legs tl
        where tl.group_id = g.id
          and tl.direction = 'departure'
      )
  ), 0) as no_departure,

  -- Hampers still pending (any status except delivered)
  coalesce((
    select count(*)
    from public.deliverables d
    where d.event_id = e.id
      and d.kind = 'hamper'
      and d.status <> 'delivered'
  ), 0) as hampers_pending

from public.events e;

-- ---------------------------------------------------------------------
-- No enum change needed — messages.provider is text already.
-- 'manual' is a valid value without any DDL.
-- ---------------------------------------------------------------------
