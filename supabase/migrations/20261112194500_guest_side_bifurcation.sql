-- =====================================================================
-- Guest side bifurcation: Father's / Mother's sub-side on guest_groups
--
-- Keeps app.side ('bride' | 'groom' | 'both' | 'other') intact and adds
-- sub_side ('father' | 'mother' | null) so imports and views can cleanly
-- bifurcate Groom Side / Bride Side into:
--   - Groom's Father Side  (side = 'groom', sub_side = 'father')
--   - Groom's Mother Side  (side = 'groom', sub_side = 'mother')
--   - Bride's Father Side  (side = 'bride', sub_side = 'father')
--   - Bride's Mother Side  (side = 'bride', sub_side = 'mother')
-- =====================================================================

alter table public.guest_groups
  add column if not exists sub_side text;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'guest_groups_sub_side_check'
       and conrelid = 'public.guest_groups'::regclass
  ) then
    alter table public.guest_groups
      add constraint guest_groups_sub_side_check
      check (sub_side is null or sub_side in ('father', 'mother'));
  end if;
end $$;

create index if not exists guest_groups_event_side_sub_side_idx
  on public.guest_groups (event_id, side, sub_side);

-- ── commit_guest_import ───────────────────────────────────────────────
create or replace function public.commit_guest_import(
  p_event_id uuid,
  p_kind     text,
  p_filename text,
  p_rows     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch_id    uuid;
  v_row         jsonb;
  v_head        text;
  v_hash        text;
  v_group_id    uuid;
  v_existing_id uuid;
  v_mobile      text;
  v_alt         text;
  v_code        text;
  v_city        text;
  v_side        app.side;
  v_sub_side    text;
  v_group_type  app.group_type;
  v_pax         integer;
  v_gift        boolean;
  v_remarks     text;
  v_row_number  integer;
  v_can_import  boolean;
  v_reason      text;
  v_inserted    integer := 0;
  v_updated     integer := 0;
  v_skipped     integer := 0;
  v_failed      integer := 0;
begin
  if not app.is_staff(p_event_id) then
    raise exception 'Not permitted.' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows must be a jsonb array of import rows.';
  end if;

  insert into public.import_batches (event_id, kind, filename, total_rows, status, imported_by)
  values (p_event_id, p_kind, p_filename, jsonb_array_length(p_rows), 'processing', auth.uid())
  returning id into v_batch_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_row_number := coalesce((v_row ->> 'rowNumber')::integer, 0);
    v_hash       := v_row ->> 'rowHash';
    v_head       := v_row ->> 'headName';
    v_can_import := coalesce((v_row ->> 'canImport')::boolean, true);
    v_reason     := v_row ->> 'blockReason';
    v_code       := v_row ->> 'groupCode';
    v_mobile     := v_row ->> 'primaryMobile';
    v_alt        := v_row ->> 'altMobile';
    v_city       := v_row ->> 'city';
    v_side       := nullif(v_row ->> 'side', '')::app.side;
    v_sub_side   := nullif(lower(trim(coalesce(v_row ->> 'subSide', ''))), '');
    if v_sub_side not in ('father', 'mother') then
      v_sub_side := null;
    end if;
    if v_side in ('both', 'other') then
      v_sub_side := null;
    end if;
    v_group_type := coalesce(nullif(v_row ->> 'groupType', '')::app.group_type, 'family');
    v_pax        := (v_row ->> 'expectedPax')::integer;
    v_gift       := coalesce((v_row ->> 'needsReturnGift')::boolean, false);
    v_remarks    := v_row ->> 'remarks';

    if not v_can_import or v_head is null or v_head = '' then
      v_failed := v_failed + 1;
      insert into public.import_rows (
        event_id, batch_id, row_number, raw, row_hash, status, error
      ) values (
        p_event_id, v_batch_id, v_row_number,
        coalesce(v_row -> 'raw', '{}'::jsonb),
        coalesce(v_hash, ''),
        'error',
        coalesce(v_reason, 'Row has no head name.')
      );
      continue;
    end if;

    v_existing_id := null;

    select g.id into v_existing_id
      from public.guest_groups g
     where g.event_id = p_event_id
       and g.source_row_hash = v_hash
     limit 1;

    if v_existing_id is null then
      if (select count(*) from public.guest_groups g
            where g.event_id = p_event_id
              and lower(regexp_replace(g.head_name, '\s+', ' ', 'g')) =
                  lower(regexp_replace(v_head, '\s+', ' ', 'g'))) = 1
      then
        select g.id into v_existing_id
          from public.guest_groups g
         where g.event_id = p_event_id
           and lower(regexp_replace(g.head_name, '\s+', ' ', 'g')) =
               lower(regexp_replace(v_head, '\s+', ' ', 'g'))
         limit 1;

        if v_existing_id is not null and v_mobile is not null then
          if exists (
            select 1 from public.guest_groups g2
             where g2.id = v_existing_id
               and g2.primary_mobile is not null
               and g2.primary_mobile <> v_mobile
          ) then
            v_existing_id := null;
          end if;
        end if;
      end if;
    end if;

    if v_existing_id is not null then
      update public.guest_groups g
         set group_code       = coalesce(nullif(v_code, ''), g.group_code),
             primary_mobile   = coalesce(nullif(v_mobile, ''), g.primary_mobile),
             alt_mobile       = coalesce(nullif(v_alt, ''), g.alt_mobile),
             city             = coalesce(nullif(v_city, ''), g.city),
             side             = coalesce(v_side, g.side),
             sub_side         = case
                                  when v_sub_side is not null then v_sub_side
                                  when v_side is not null and v_side is distinct from g.side then null
                                  else g.sub_side
                                end,
             group_type       = v_group_type,
             expected_pax     = coalesce(v_pax, g.expected_pax),
             needs_return_gift= coalesce(v_gift, g.needs_return_gift),
             remarks          = coalesce(nullif(v_remarks, ''), g.remarks),
             source_row_hash  = v_hash,
             updated_at       = now()
       where g.id = v_existing_id;

      if not exists (
        select 1 from public.guests
         where group_id = v_existing_id and is_head
      ) then
        insert into public.guests (event_id, group_id, full_name, mobile, is_head)
        values (p_event_id, v_existing_id, v_head, v_mobile, true);
      end if;

      v_updated := v_updated + 1;
      insert into public.import_rows (
        event_id, batch_id, row_number, raw, row_hash, status, group_id
      ) values (
        p_event_id, v_batch_id, v_row_number,
        coalesce(v_row -> 'raw', '{}'::jsonb), v_hash, 'updated', v_existing_id
      );

      perform public.upsert_import_leg(
        p_event_id, v_existing_id, 'arrival', v_row -> 'arrival'
      );
      perform public.upsert_import_leg(
        p_event_id, v_existing_id, 'departure', v_row -> 'departure'
      );
      continue;
    end if;

    begin
      insert into public.guest_groups (
        event_id, group_code, head_name, primary_mobile, alt_mobile,
        side, sub_side, group_type, city, expected_pax, needs_return_gift,
        remarks, source_row_hash, created_by
      ) values (
        p_event_id, nullif(v_code, ''), v_head, nullif(v_mobile, ''),
        nullif(v_alt, ''), v_side, v_sub_side, v_group_type, nullif(v_city, ''),
        coalesce(v_pax, 1), coalesce(v_gift, false),
        nullif(v_remarks, ''), v_hash, auth.uid()
      )
      returning id into v_group_id;

      insert into public.guests (event_id, group_id, full_name, mobile, is_head)
      values (p_event_id, v_group_id, v_head, nullif(v_mobile, ''), true);

      v_inserted := v_inserted + 1;
      insert into public.import_rows (
        event_id, batch_id, row_number, raw, row_hash, status, group_id
      ) values (
        p_event_id, v_batch_id, v_row_number,
        coalesce(v_row -> 'raw', '{}'::jsonb), v_hash, 'inserted', v_group_id
      );

      perform public.upsert_import_leg(
        p_event_id, v_group_id, 'arrival', v_row -> 'arrival'
      );
      perform public.upsert_import_leg(
        p_event_id, v_group_id, 'departure', v_row -> 'departure'
      );
    exception
      when unique_violation then
        v_skipped := v_skipped + 1;
        insert into public.import_rows (
          event_id, batch_id, row_number, raw, row_hash, status, error
        ) values (
          p_event_id, v_batch_id, v_row_number,
          coalesce(v_row -> 'raw', '{}'::jsonb), v_hash,
          'skipped', 'A family with this row hash already exists for this event.'
        );
    end;
  end loop;

  update public.import_batches
     set status       = 'completed',
         inserted_rows = v_inserted,
         updated_rows  = v_updated,
         skipped_rows  = v_skipped,
         completed_at  = now()
   where id = v_batch_id;

  return jsonb_build_object(
    'batchId',  v_batch_id,
    'inserted', v_inserted,
    'updated',  v_updated,
    'skipped',  v_skipped,
    'failed',   v_failed,
    'total',    jsonb_array_length(p_rows)
  );
end;
$$;

grant execute on function public.commit_guest_import(uuid, text, text, jsonb)
  to authenticated;

-- ── v_rsvp_queue (append sub_side at the end) ─────────────────────────
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
  c.next_callback_at,
  gg.last_opened_by_staff,
  gg.last_opened_at,
  sm.full_name as last_opened_by_name,
  gg.locked_by_staff,
  gg.sub_side
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

-- ── client_guest_profiles ─────────────────────────────────────────────
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
  gg.sub_side,
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

-- ── search_guest_profiles ─────────────────────────────────────────────
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
  sub_side              text,
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
    gg.sub_side,
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
