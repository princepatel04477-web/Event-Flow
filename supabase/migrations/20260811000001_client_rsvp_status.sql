-- =====================================================================
-- 20260811000000 client_rsvp_status.sql
-- Add rsvp_status to client_guest_profiles — SRS §8 gap.
-- =====================================================================

-- This MUST be a full CREATE OR REPLACE rather than ALTER VIEW, because
-- security_invoker = false is a per-view property that supersedes the
-- base-table RLS. ALTER VIEW cannot toggle it; a drop + replace is the
-- only safe path, and the view has no dependencies that would break.
drop view if exists public.client_guest_profiles cascade;

create or replace view public.client_guest_profiles
with (security_invoker = false) as
select
  g.event_id,
  g.id                        as guest_id,
  g.full_name                 as guest_name,
  gg.head_name                as family_head,
  gg.group_type,
  gg.side,
  coalesce(gg.confirmed_pax, gg.expected_pax) as pax,
  gg.rsvp_status,

  h.name                      as hotel_name,
  r.room_number,

  arr.travel_date             as arrival_date,
  arr.travel_time             as arrival_time,
  arr.mode                    as arrival_mode,
  arr.point                   as arrival_point,

  dep.travel_date             as departure_date,
  dep.travel_time             as departure_time,
  dep.mode                    as departure_mode,
  dep.point                   as departure_point,

  coalesce(ham.delivered, false)                          as hamper_delivered,
  case when gg.needs_return_gift
       then coalesce(rgf.delivered, false) end            as return_gift_delivered,
  gg.needs_return_gift
from public.guests g
join public.guest_groups gg
  on gg.id = g.group_id
left join public.room_assignments ra
  on ra.guest_id = g.id and ra.released_at is null
left join public.rooms r   on r.id = ra.room_id
left join public.hotels h  on h.id = r.hotel_id
left join lateral (
  select tl.* from public.travel_legs tl
  where tl.group_id = gg.id and tl.direction = 'arrival'
  order by tl.travel_date nulls last, tl.travel_time nulls last
  limit 1
) arr on true
left join lateral (
  select tl.* from public.travel_legs tl
  where tl.group_id = gg.id and tl.direction = 'departure'
  order by tl.travel_date nulls last, tl.travel_time nulls last
  limit 1
) dep on true
left join lateral (
  select bool_or(d.status = 'delivered') as delivered
  from public.deliverables d
  where d.group_id = gg.id and d.kind = 'hamper'
) ham on true
left join lateral (
  select bool_or(d.status = 'delivered') as delivered
  from public.deliverables d
  where d.group_id = gg.id and d.kind = 'return_gift'
) rgf on true
where app.is_member(g.event_id);

grant select on public.client_guest_profiles to authenticated;
