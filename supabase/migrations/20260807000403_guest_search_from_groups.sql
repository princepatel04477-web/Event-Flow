-- =====================================================================
-- 1803 GUEST LIST/SEARCH — start from guest_groups, LEFT JOIN guests
--
-- 1802 started the query from public.guests (INNER join to guest_groups),
-- which silently dropped groups whose head has no guest row — "arpit"
-- was searchable in guest_groups but returned ZERO search results. A
-- family head must always be findable even when the per-guest row is
-- missing (imports create the group first, the guest row may lag).
--
-- This append-only migration re-creates the function with the join
-- reversed: from guest_groups, LEFT JOIN guests. Every group is emitted;
-- groups WITH guest rows emit one result per guest (matching the list
-- screen's row-per-guest), groups WITHOUT emit one result (guest_name =
-- head_name). Same OUT columns; drop is required again (42P13).
--
-- IDEMPOTENT: drop function if exists; create function; grant execute.
-- =====================================================================

drop function if exists public.search_guest_profiles(uuid, text, integer);

create function public.search_guest_profiles(
  p_event_id uuid,
  p_term     text,
  p_limit    integer default 50
)
returns table (
  event_id              uuid,
  guest_id              uuid,
  group_id              uuid,
  guest_name            text,
  family_head           text,
  group_type            app.group_type,
  side                  app.side,
  pax                   integer,
  hotel_name            text,
  room_number           text,
  arrival_date          date,
  arrival_time          time,
  arrival_mode          app.travel_mode,
  arrival_point         text,
  departure_date        date,
  departure_time        time,
  departure_mode        app.travel_mode,
  departure_point       text,
  hamper_delivered      boolean,
  return_gift_delivered boolean,
  needs_return_gift     boolean,
  phone                 text
)
language sql
stable
as $$
  select
    gg.event_id,
    coalesce(gu.id, gg.id)                                as guest_id,
    gg.id                                                 as group_id,
    coalesce(gu.full_name, gg.head_name)                  as guest_name,
    gg.head_name                                          as family_head,
    gg.group_type,
    gg.side,
    coalesce(gg.confirmed_pax, gg.expected_pax)           as pax,
    h.name                                                as hotel_name,
    r.room_number,
    arr.travel_date                                       as arrival_date,
    arr.travel_time                                       as arrival_time,
    arr.mode                                              as arrival_mode,
    arr.point                                             as arrival_point,
    dep.travel_date                                       as departure_date,
    dep.travel_time                                       as departure_time,
    dep.mode                                              as departure_mode,
    dep.point                                             as departure_point,
    coalesce(ham.delivered, false)                        as hamper_delivered,
    case when gg.needs_return_gift
         then coalesce(rgf.delivered, false) end           as return_gift_delivered,
    gg.needs_return_gift,
    gg.primary_mobile                                     as phone
  from public.guest_groups gg
  left join public.guests gu
    on gu.group_id = gg.id
  left join public.room_assignments ra
    on ra.guest_id = coalesce(gu.id, gg.id) and ra.released_at is null
  left join public.rooms r  on r.id = ra.room_id
  left join public.hotels h on h.id = r.hotel_id
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
  where gg.event_id = p_event_id
    and (
      p_term = ''
      or gg.head_name ilike '%' || p_term || '%'
      or gu.full_name ilike '%' || p_term || '%'
      or gg.primary_mobile ilike '%' || p_term || '%'
    )
  order by gg.head_name nulls last, coalesce(gu.full_name, gg.head_name) nulls last
  limit greatest(p_limit, 1);
$$;

grant execute on function public.search_guest_profiles(uuid, text, integer) to authenticated;
