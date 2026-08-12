-- =====================================================================
-- 1800 GUEST LIST SEARCH (bounded-rendering support)
--
-- Makes partial-match search on the guest list fast, and provides the
-- server-side search the /guests screen uses. The screen itself moves to
-- bounded (windowed) rendering so 543+ guests never all mount at once.
--
-- WHY A NEW SEARCH PATH, NOT THE VIEW:
--   public.client_guest_profiles is a deliberate data-minimization
--   boundary (CLAUDE.md taste: "views as deliberate security boundaries").
--   It excludes phone numbers and gates on app.is_member. /guests is a
--   STAFF screen, and the task requires search on name AND phone. So the
--   search reads the staff tables (guest_groups, guests) directly, under
--   the caller's own RLS — staff see phones, clients never do.
--
-- IDEMPOTENCY: create extension if not exists, create index if not
-- exists, create or replace function, grant execute (idempotent).
-- =====================================================================

create extension if not exists pg_trgm;

-- Partial-match (middle-of-string) search on family head names.
-- pg_trgm GIN is the index for `%term%` ILIKE — a plain btree can only
-- serve prefix matches.
create index if not exists guest_groups_head_name_trgm_idx
  on public.guest_groups using gin (head_name gin_trgm_ops);

-- Partial-match search on individual guest names.
create index if not exists guests_full_name_trgm_idx
  on public.guests using gin (full_name gin_trgm_ops);

-- Partial-match search on the family's primary mobile (staff search by
-- phone digits). The existing btree (event_id, primary_mobile) serves
-- exact-number lookups; trgm serves "type a few digits".
create index if not exists guest_groups_primary_mobile_trgm_idx
  on public.guest_groups using gin (primary_mobile gin_trgm_ops);

-- ---------------------------------------------------------------------
-- RPC: server-side guest search.
--
-- Deliberately NOT security definer: it runs as the signed-in caller, so
-- RLS applies exactly as it does to every other staff read. A client
-- login gets zero rows (guest_groups has no client select policy).
--
-- Returns rows shaped like client_guest_profiles plus `phone` (the staff-
-- visible search column), so the SAME GuestCard component renders a
-- search result and a normal list row.
--
-- Matching: ILIKE '%term%' on head_name, guest full_name, and the
-- primary mobile. ILIKE is case-insensitive (covers Latin); Devanagari
-- has no case, so ILIKE matches it verbatim — a partial Devanagari name
-- matches. Ordering: head_name then guest_name, matching the list.
-- Cap: 50 rows — search is for finding ONE family, not paging the world.
-- ---------------------------------------------------------------------

create or replace function public.search_guest_profiles(
  p_event_id uuid,
  p_term     text
)
returns table (
  event_id              uuid,
  guest_id              uuid,
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
    g.event_id,
    g.id                                              as guest_id,
    g.full_name                                       as guest_name,
    gg.head_name                                      as family_head,
    gg.group_type,
    gg.side,
    coalesce(gg.confirmed_pax, gg.expected_pax)       as pax,
    h.name                                            as hotel_name,
    r.room_number,
    arr.travel_date                                   as arrival_date,
    arr.travel_time                                   as arrival_time,
    arr.mode                                          as arrival_mode,
    arr.point                                         as arrival_point,
    dep.travel_date                                   as departure_date,
    dep.travel_time                                   as departure_time,
    dep.mode                                          as departure_mode,
    dep.point                                         as departure_point,
    coalesce(ham.delivered, false)                    as hamper_delivered,
    case when gg.needs_return_gift
         then coalesce(rgf.delivered, false) end       as return_gift_delivered,
    gg.needs_return_gift,
    gg.primary_mobile                                 as phone
  from public.guests g
  join public.guest_groups gg on gg.id = g.group_id
  left join public.room_assignments ra
    on ra.guest_id = g.id and ra.released_at is null
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
  where g.event_id = p_event_id
    and (
      gg.head_name ilike '%' || p_term || '%'
      or g.full_name ilike '%' || p_term || '%'
      or gg.primary_mobile ilike '%' || p_term || '%'
    )
  order by gg.head_name nulls last, g.full_name nulls last
  limit 50;
$$;

grant execute on function public.search_guest_profiles(uuid, text) to authenticated;
