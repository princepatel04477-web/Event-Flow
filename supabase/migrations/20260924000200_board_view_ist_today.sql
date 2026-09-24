-- =====================================================================
-- M45: arrivals_today / departures_today use Asia/Kolkata date
--
-- Replacing `current_date` with `(now() at time zone 'Asia/Kolkata')::date`
-- so that between 00:00 and 05:30 IST the view counts the Indian event day
-- rather than UTC's previous day.
-- =====================================================================

create or replace view public.v_event_board
with (security_invoker = true) as
select
  e.id as event_id,
  e.name,

  -- ---- counters (was v_event_dashboard) ----
  (select count(*) from public.guest_groups g where g.event_id = e.id) as total_groups,
  (select coalesce(sum(coalesce(g.confirmed_pax, g.expected_pax)), 0)
     from public.guest_groups g where g.event_id = e.id) as total_pax,
  (select count(*) from public.guest_groups g
     where g.event_id = e.id and g.rsvp_status = 'confirmed') as rsvp_confirmed,
  (select count(*) from public.guest_groups g
     where g.event_id = e.id and g.rsvp_status in ('not_started','attempted','callback','tentative'))
       as rsvp_pending,
  (select count(*) from public.travel_legs t
     where t.event_id = e.id and t.direction = 'arrival'
       and t.travel_date = (now() at time zone 'Asia/Kolkata')::date) as arrivals_today,
  (select count(*) from public.travel_legs t
     where t.event_id = e.id and t.direction = 'departure'
       and t.travel_date = (now() at time zone 'Asia/Kolkata')::date) as departures_today,
  (select count(*) from public.room_assignments ra
     where ra.event_id = e.id and ra.released_at is null) as guests_roomed,
  (select count(*) from public.deliverables d
     where d.event_id = e.id and d.kind = 'hamper' and d.status = 'delivered') as hampers_delivered,
  (select count(*) from public.deliverables d
     where d.event_id = e.id and d.kind = 'hamper' and d.status <> 'delivered') as hampers_pending,
  (select count(*) from public.deliverables d
     where d.event_id = e.id and d.kind = 'return_gift' and d.status = 'delivered')
       as return_gifts_delivered,
  (select coalesce(sum(t.expense_amount), 0) from public.trips t
     where t.event_id = e.id) as logistics_expense,

  -- ---- attention (was v_event_attention) ----
  -- Confirmed families with no active room assignment.
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

  -- Arrivals today with no vehicle (trip) assigned to the group.
  coalesce((
    select count(distinct g.id)
    from public.travel_legs tl
    join public.guest_groups g
      on g.id = tl.group_id and g.event_id = tl.event_id
    where tl.event_id = e.id
      and tl.direction = 'arrival'
      and tl.travel_date = (now() at time zone 'Asia/Kolkata')::date
      and not exists (
        select 1
        from public.trip_passengers tp
        join public.trips t
          on t.id = tp.trip_id and t.event_id = tp.event_id
        where tp.group_id = g.id
          and t.direction = 'arrival'
      )
  ), 0) as arrivals_no_vehicle,

  -- Confirmed families with no departure leg recorded.
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
  ), 0) as no_departure

from public.events e;

grant select on public.v_event_board to authenticated;
