-- 20260809120000 MERGED DASHBOARD VIEW
-- ---------------------------------------------------------------------
-- v_event_board = v_event_dashboard + v_event_attention, one row per event.
--
-- WHY. The board reads both views on every load. They are separate round
-- trips to the Supabase region (Seoul), and from India that is ~150-320ms
-- EACH — the query itself runs in single-digit milliseconds. They also both
-- scan `events` and both compute `hampers_pending`, so the second trip pays
-- for work the first already did.
--
-- SECURITY. `security_invoker = true`, identical to both source views, so
-- this runs as the CALLER and normal RLS applies:
--   * staff  -> real counters (app.is_staff() true on the subquery tables)
--   * client -> one row of zeros, exactly as before, because `events` RLS is
--               is_member() (true) while every counter subquery is fenced by
--               is_staff() (false). The page's requireStaff() guard is what
--               stops a client ever seeing this; that is unchanged.
-- No policy, grant or RPC is altered. This is additive.
--
-- The two source views are deliberately NOT dropped: `v_event_dashboard` is
-- named in CLAUDE.md's table map and may be read by ad-hoc queries or a
-- future admin screen. A merged read path does not require removing them.
-- ---------------------------------------------------------------------

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
       and t.travel_date = current_date) as arrivals_today,
  (select count(*) from public.travel_legs t
     where t.event_id = e.id and t.direction = 'departure'
       and t.travel_date = current_date) as departures_today,
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

-- Same grant as the two views it replaces on the read path.
grant select on public.v_event_board to authenticated;
