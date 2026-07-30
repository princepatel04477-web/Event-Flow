-- =====================================================================
-- 0600 VIEWS + RPC
-- =====================================================================

-- ---------------------------------------------------------------------
-- CLIENT PROFILE CARD
-- The ONLY thing a client login can read. security_invoker = false means
-- the view runs as owner and bypasses base-table RLS, so the WHERE clause
-- below is the fence. It is deliberately narrow: no mobile numbers, no
-- expenses, no call history, no other event.
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
-- STAFF VIEWS — security_invoker = true, so normal staff RLS applies
-- and a client login sees nothing through them.
-- ---------------------------------------------------------------------

-- The calling queue for Phase 1.
create or replace view public.v_rsvp_queue
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
  c.next_callback_at
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

grant select on public.v_rsvp_queue to authenticated;

-- LHS = RHS. Every group that arrived must be accounted for on the way out.
create or replace view public.v_travel_ledger
with (security_invoker = true) as
select
  gg.event_id,
  gg.id           as group_id,
  gg.head_name,
  coalesce(gg.confirmed_pax, gg.expected_pax) as pax,
  count(*) filter (where tl.direction = 'arrival')   as arrival_legs,
  count(*) filter (where tl.direction = 'departure') as departure_legs,
  case
    when count(*) filter (where tl.direction = 'arrival') = 0 then 'no_arrival'
    when count(*) filter (where tl.direction = 'departure') = 0 then 'departure_missing'
    else 'balanced'
  end as ledger_state
from public.guest_groups gg
left join public.travel_legs tl on tl.group_id = gg.id
group by gg.event_id, gg.id, gg.head_name, gg.confirmed_pax, gg.expected_pax;

grant select on public.v_travel_ledger to authenticated;

-- Admin dashboard counters.
create or replace view public.v_event_dashboard
with (security_invoker = true) as
select
  e.id as event_id,
  e.name,
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
     where t.event_id = e.id) as logistics_expense
from public.events e;

grant select on public.v_event_dashboard to authenticated;

-- ---------------------------------------------------------------------
-- RPC: caller locking. Stops two callers dialling the same family head.
-- ---------------------------------------------------------------------

create or replace function public.claim_group(p_group_id uuid, p_minutes integer default 15)
returns public.guest_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.guest_groups;
begin
  update public.guest_groups g
     set locked_by    = auth.uid(),
         locked_until = now() + make_interval(mins => p_minutes),
         updated_at   = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_until is null
          or g.locked_until < now()
          or g.locked_by = auth.uid())
  returning * into v_group;

  if v_group.id is null then
    raise exception 'Group % is locked by another caller right now.', p_group_id
      using errcode = '55P03';  -- lock_not_available
  end if;

  return v_group;
end;
$$;

create or replace function public.release_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.guest_groups g
     set locked_by = null, locked_until = null, updated_at = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_by = auth.uid() or app.is_admin());
end;
$$;

-- ---------------------------------------------------------------------
-- RPC: commit a REVIEWED extraction.
-- This is the only path from AI output into real guest data. It runs in
-- one transaction, so a review either lands completely or not at all.
-- ---------------------------------------------------------------------

create or replace function public.apply_rsvp_extraction(
  p_extraction_id uuid,
  p_payload       jsonb
)
returns public.guest_groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ex      public.rsvp_extractions;
  v_group   public.guest_groups;
  v_dirtext text;
  v_dir     app.travel_direction;
  v_leg     jsonb;
  v_leg_id  uuid;
begin
  select * into v_ex from public.rsvp_extractions where id = p_extraction_id;
  if not found then
    raise exception 'Extraction % not found.', p_extraction_id;
  end if;

  if not app.is_staff(v_ex.event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if v_ex.status = 'accepted' then
    raise exception 'Extraction % has already been applied.', p_extraction_id;
  end if;

  update public.guest_groups g
     set rsvp_status   = coalesce((p_payload ->> 'rsvp_status')::app.rsvp_status, g.rsvp_status),
         confirmed_pax = coalesce((p_payload ->> 'confirmed_pax')::integer, g.confirmed_pax),
         side          = coalesce((p_payload ->> 'side')::app.side, g.side),
         remarks       = coalesce(p_payload ->> 'remarks', g.remarks),
         locked_by     = null,
         locked_until  = null,
         updated_at    = now()
   where g.id = v_ex.group_id
  returning * into v_group;

  foreach v_dirtext in array array['arrival', 'departure'] loop
    v_leg := p_payload -> v_dirtext;

    if v_leg is not null and jsonb_typeof(v_leg) = 'object' then
      v_dir := v_dirtext::app.travel_direction;

      select tl.id into v_leg_id
        from public.travel_legs tl
       where tl.group_id = v_ex.group_id and tl.direction = v_dir
       order by tl.created_at
       limit 1;

      if v_leg_id is null then
        insert into public.travel_legs (
          event_id, group_id, direction, mode, travel_date, travel_time,
          reference, point, pax_on_leg, source
        ) values (
          v_ex.event_id, v_ex.group_id, v_dir,
          nullif(v_leg ->> 'mode', '')::app.travel_mode,
          nullif(v_leg ->> 'date', '')::date,
          nullif(v_leg ->> 'time', '')::time,
          nullif(v_leg ->> 'reference', ''),
          nullif(v_leg ->> 'point', ''),
          nullif(v_leg ->> 'pax', '')::integer,
          'rsvp_call'
        );
      else
        update public.travel_legs tl
           set mode        = coalesce(nullif(v_leg ->> 'mode', '')::app.travel_mode, tl.mode),
               travel_date = coalesce(nullif(v_leg ->> 'date', '')::date, tl.travel_date),
               travel_time = coalesce(nullif(v_leg ->> 'time', '')::time, tl.travel_time),
               reference   = coalesce(nullif(v_leg ->> 'reference', ''), tl.reference),
               point       = coalesce(nullif(v_leg ->> 'point', ''), tl.point),
               pax_on_leg  = coalesce(nullif(v_leg ->> 'pax', '')::integer, tl.pax_on_leg),
               updated_at  = now()
         where tl.id = v_leg_id;
      end if;
    end if;
  end loop;

  update public.rsvp_extractions
     set status       = 'accepted',
         parsed       = p_payload,          -- store what the human actually approved
         reviewed_by  = auth.uid(),
         reviewed_at  = now(),
         applied_at   = now()
   where id = p_extraction_id;

  return v_group;
end;
$$;

grant execute on function public.claim_group(uuid, integer),
                        public.release_group(uuid),
                        public.apply_rsvp_extraction(uuid, jsonb)
  to authenticated;
