-- End-to-end verification of the allocation + override guarantees, straight
-- against Postgres: the capacity trigger, the partial unique index, and the
-- soft-release semantics the override screen depends on.
\set ON_ERROR_STOP on
\pset pager off

create temporary table results (n serial, label text, ok boolean, detail text);

do $$
declare
  v_event  uuid;
  v_hotel  uuid;
  v_a1     uuid;
  v_a3     uuid;
  v_grp    uuid;
  v_grp2   uuid;
  v_g      uuid[];
  v_o      uuid[];
  v_n      integer;
  v_err    text;
  v_code   text;
  v_body   text;
begin
  -- ---------- fixtures ----------
  insert into public.events (name, code, starts_on, ends_on)
  values ('Alloc E2E', 'ALLOCE2E', '2026-12-20', '2026-12-24')
  returning id into v_event;

  insert into public.hotels (event_id, name) values (v_event, 'E2E Hotel')
  returning id into v_hotel;

  insert into public.rooms (event_id, hotel_id, room_number, capacity)
  values (v_event, v_hotel, 'A1', 2) returning id into v_a1;
  insert into public.rooms (event_id, hotel_id, room_number, capacity)
  values (v_event, v_hotel, 'A3', 4) returning id into v_a3;

  insert into public.guest_groups
    (event_id, head_name, primary_mobile, expected_pax, confirmed_pax, rsvp_status, group_type)
  values (v_event, 'E2E Family', '9000000001', 4, 4, 'confirmed', 'family')
  returning id into v_grp;

  -- A data-modifying statement has to live in a WITH clause, not a FROM
  -- subquery.
  with ins as (
    insert into public.guests (event_id, group_id, full_name, is_head, age_band)
    values (v_event, v_grp, 'E2E Guest 1', true,  'adult'),
           (v_event, v_grp, 'E2E Guest 2', false, 'adult'),
           (v_event, v_grp, 'E2E Guest 3', false, 'adult'),
           (v_event, v_grp, 'E2E Guest 4', false, 'adult')
    returning id, full_name
  )
  select array_agg(id order by full_name) into v_g from ins;

  insert into public.guest_groups
    (event_id, head_name, primary_mobile, expected_pax, confirmed_pax, rsvp_status)
  values (v_event, 'E2E Overflow', '9000000002', 3, 3, 'confirmed')
  returning id into v_grp2;

  with ins2 as (
    insert into public.guests (event_id, group_id, full_name, is_head, age_band)
    values (v_event, v_grp2, 'Ovf 1', true,  'adult'),
           (v_event, v_grp2, 'Ovf 2', false, 'adult'),
           (v_event, v_grp2, 'Ovf 3', false, 'adult')
    returning id, full_name
  )
  select array_agg(id order by full_name) into v_o from ins2;

  -- ---------- 1. commit the plan (4 guests into the exact 4-bed room) ----------
  insert into public.room_assignments (event_id, room_id, guest_id, group_id)
  select v_event, v_a3, g, v_grp from unnest(v_g) g;

  select count(*) into v_n from public.room_assignments
   where room_id = v_a3 and released_at is null;
  insert into results (label, ok, detail)
  values ('commit placed all four in the 4-bed room', v_n = 4, v_n::text);

  -- ---------- 2. a batch containing one bad row writes NOTHING ----------
  begin
    insert into public.room_assignments (event_id, room_id, guest_id, group_id)
    values (v_event, v_a1, v_o[1], v_grp2),          -- fine
           (v_event, v_a1, v_g[1], v_grp);           -- already active -> 23505
    insert into results (label, ok, detail) values ('batch with a bad row refused', false, 'no error raised');
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
    insert into results (label, ok, detail) values ('batch with a bad row refused', true, v_code);
  end;

  select count(*) into v_n from public.room_assignments
   where room_id = v_a1 and released_at is null;
  insert into results (label, ok, detail)
  values ('ATOMIC: failed batch wrote nothing', v_n = 0, v_n::text);

  -- ---------- 3. capacity guard ----------
  insert into public.room_assignments (event_id, room_id, guest_id, group_id)
  values (v_event, v_a1, v_o[1], v_grp2), (v_event, v_a1, v_o[2], v_grp2);

  select count(*) into v_n from public.room_assignments
   where room_id = v_a1 and released_at is null;
  insert into results (label, ok, detail) values ('A1 filled to its capacity of 2', v_n = 2, v_n::text);

  begin
    insert into public.room_assignments (event_id, room_id, guest_id, group_id)
    values (v_event, v_a1, v_o[3], v_grp2);
    insert into results (label, ok, detail) values ('third guest into a 2-bed refused', false, 'no error');
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate, v_err = message_text;
    insert into results (label, ok, detail)
    values ('third guest into a 2-bed refused', true, v_code);
    insert into results (label, ok, detail)
    values ('refusal is the capacity guard 23514', v_code = '23514', v_code);
  end;

  -- override WITHOUT a reason must still fail (check constraint)
  begin
    insert into public.room_assignments (event_id, room_id, guest_id, group_id, is_override, override_reason)
    values (v_event, v_a1, v_o[3], v_grp2, true, null);
    insert into results (label, ok, detail) values ('override with no reason refused', false, 'accepted');
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
    insert into results (label, ok, detail) values ('override with no reason refused', true, v_code);
  end;

  -- override WITH a reason succeeds
  insert into public.room_assignments
    (event_id, room_id, guest_id, group_id, is_override, override_reason)
  values (v_event, v_a1, v_o[3], v_grp2, true, 'Grandmother wants to stay with the family');

  select count(*) into v_n from public.room_assignments
   where room_id = v_a1 and released_at is null;
  insert into results (label, ok, detail)
  values ('override accepted with a typed reason', v_n = 3, v_n::text);
  insert into results (label, ok, detail)
  values ('room is now over capacity (3 in a 2-bed)', v_n > 2, v_n::text);

  select count(*) into v_n from public.room_assignments
   where room_id = v_a1 and is_override and override_reason is not null;
  insert into results (label, ok, detail) values ('reason stored on the row', v_n = 1, v_n::text);

  -- ---------- 4. release is soft ----------
  update public.room_assignments
     set released_at = now(), release_reason = 'Moved to another room'
   where guest_id = v_g[1] and released_at is null;

  select count(*) into v_n from public.room_assignments where guest_id = v_g[1];
  insert into results (label, ok, detail) values ('history row kept after release', v_n = 1, v_n::text);

  select count(*) into v_n from public.room_assignments
   where guest_id = v_g[1] and released_at is null;
  insert into results (label, ok, detail) values ('no active assignment after release', v_n = 0, v_n::text);

  select count(*) into v_n from public.room_assignments
   where guest_id = v_g[1] and release_reason = 'Moved to another room';
  insert into results (label, ok, detail) values ('release reason recorded', v_n = 1, v_n::text);

  -- ---------- 5. the guard bites on a move as well as an add ----------
  -- Inner block on purpose: an EXCEPTION handler rolls back to the start of
  -- the block that owns it, so catching this at the outer level would
  -- discard every fixture above.
  begin
    insert into public.room_assignments (event_id, room_id, guest_id, group_id)
    values (v_event, v_a1, v_g[2], v_grp);   -- A1 already holds 3 in 2 beds
    insert into results (label, ok, detail)
    values ('moving into a full room is refused too', false, 'accepted');
  exception when others then
    get stacked diagnostics v_code = returned_sqlstate;
    insert into results (label, ok, detail)
    values ('moving into a full room is refused too', v_code = '23514', v_code);
  end;
end $$;

-- The move must still be completable into a room that has space.
do $$
declare
  v_event uuid; v_a3 uuid; v_grp uuid; v_guest uuid; v_n integer;
begin
  select id into v_event from public.events where code = 'ALLOCE2E';
  select id into v_a3 from public.rooms where event_id = v_event and room_number = 'A3';
  select id into v_grp from public.guest_groups where event_id = v_event and head_name = 'E2E Family';
  select id into v_guest from public.guests where group_id = v_grp and full_name = 'E2E Guest 1';

  insert into public.room_assignments (event_id, room_id, guest_id, group_id)
  values (v_event, v_a3, v_guest, v_grp);

  select count(*) into v_n from public.room_assignments
   where guest_id = v_guest and released_at is null;
  insert into results (label, ok, detail)
  values ('re-assignment after release accepted', v_n = 1, v_n::text);

  select count(*) into v_n from public.room_assignments where guest_id = v_guest;
  insert into results (label, ok, detail)
  values ('both the old and new rows exist', v_n = 2, v_n::text);
end $$;

-- ---------- 6. message queueing ----------
do $$
declare
  v_event uuid; v_grp uuid; v_body text; v_n integer;
begin
  select id into v_event from public.events where code = 'ALLOCE2E';
  select id into v_grp from public.guest_groups where event_id = v_event and head_name = 'E2E Family';

  select body into v_body from public.message_templates
   where key = 'room_allocated' and is_active limit 1;
  insert into results (label, ok, detail)
  values ('room_allocated template exists', v_body is not null, coalesce(left(v_body, 40), 'null'));

  v_body := replace(v_body, '{{head_name}}',     'E2E Family');
  v_body := replace(v_body, '{{hotel_name}}',    'E2E Hotel');
  v_body := replace(v_body, '{{room_number}}',   'A3');
  v_body := replace(v_body, '{{check_in_time}}', '14:00');
  insert into results (label, ok, detail)
  values ('all placeholders filled', v_body not like '%{{%', v_body);

  insert into public.messages (event_id, group_id, to_number, template_key, body, status)
  values (v_event, v_grp, '9000000001', 'room_allocated', v_body, 'queued');

  select count(*) into v_n from public.messages
   where event_id = v_event and status = 'queued' and sent_at is null;
  insert into results (label, ok, detail) values ('queued, not sent', v_n = 1, v_n::text);
end $$;

select label, case when ok then 'PASS' else 'FAIL' end as result, detail
  from results order by n;

select count(*) filter (where ok)     as passed,
       count(*) filter (where not ok) as failed
  from results;
