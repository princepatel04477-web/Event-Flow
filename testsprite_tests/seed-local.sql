-- Seed the LOCAL stack. Runs as postgres superuser via docker exec, so it
-- bypasses both RLS and the table grants that blocked service_role.
\set ON_ERROR_STOP on

do $$
declare
  v_user  uuid;
  v_event uuid;
  v_g1    uuid;
  v_g2    uuid;
begin
  select id into v_user from auth.users where email = 'admin@eventflow.test';
  if v_user is null then
    raise exception 'test user missing — create it via the auth admin API first';
  end if;

  update public.profiles
     set global_role = 'admin', is_active = true, full_name = 'TestSprite Admin'
   where id = v_user;

  insert into public.events (name, code, bride_name, groom_name, starts_on, ends_on, is_active, created_by)
  values ('TestSprite Wedding', 'TSTEST', 'Aisha', 'Rohan', '2026-12-20', '2026-12-24', true, v_user)
  on conflict (code) do update set name = excluded.name
  returning id into v_event;

  if v_event is null then
    select id into v_event from public.events where code = 'TSTEST';
  end if;

  insert into public.event_members (event_id, user_id, role)
  values (v_event, v_user, 'event_team')
  on conflict do nothing;

  -- Family 1: never called. This is the one with a pending extraction.
  insert into public.guest_groups
    (event_id, head_name, primary_mobile, group_code, side, expected_pax, rsvp_status, city)
  values (v_event, 'Rameshbhai Patel', '9876543210', '4TH', 'bride', 6, 'not_started', 'Ahmedabad')
  returning id into v_g1;

  -- Family 2: already confirmed, so the queue has two distinct states.
  insert into public.guest_groups
    (event_id, head_name, primary_mobile, group_code, side, expected_pax, confirmed_pax, rsvp_status, city)
  values (v_event, 'Nileshbhai Shah', '9812345678', '4TH', 'groom', 3, 3, 'confirmed', 'Surat')
  returning id into v_g2;

  insert into public.guests (event_id, group_id, full_name, mobile, is_head, age_band)
  values (v_event, v_g1, 'Rameshbhai Patel', '9876543210', true, 'adult'),
         (v_event, v_g2, 'Nileshbhai Shah',  '9812345678', true, 'adult');

  -- An existing arrival leg, so the review screen has a "what we had before"
  -- value to diff the extraction against.
  insert into public.travel_legs
    (event_id, group_id, direction, mode, travel_date, travel_time, reference, point, pax_on_leg)
  values (v_event, v_g1, 'arrival', 'air', '2026-12-18', '08:00', 'AI 101', 'Ahmedabad T1', 6);

  -- Pending extraction with deliberately mixed confidence: two fields below
  -- 0.60 must render red and arrive blank, one amber, the rest normal.
  insert into public.rsvp_extractions (event_id, group_id, model, parsed, confidence, status)
  values (
    v_event, v_g1, 'seed',
    jsonb_build_object(
      'rsvp_status', 'confirmed',
      'confirmed_pax', 4,
      'arrival', jsonb_build_object(
        'date', '2026-12-20', 'time', '10:30', 'mode', 'air',
        'reference', '6E 5074', 'point', 'Ahmedabad T2', 'pax', 4),
      'departure', null,
      'special_requests', 'wheelchair for mother',
      'language', 'gu'),
    jsonb_build_object(
      'rsvp_status', 0.95,
      'confirmed_pax', 0.88,
      'arrival.date', 0.41,
      'arrival.time', 0.72,
      'arrival.reference', 0.55,
      'arrival.mode', 0.9,
      'arrival.point', 0.9,
      'arrival.pax', 0.9,
      'special_requests', 0.9),
    'pending');

  raise notice 'seeded event % with groups % and %', v_event, v_g1, v_g2;
end $$;

select 'events' t, count(*) from public.events
union all select 'groups', count(*) from public.guest_groups
union all select 'guests', count(*) from public.guests
union all select 'legs', count(*) from public.travel_legs
union all select 'extractions', count(*) from public.rsvp_extractions
union all select 'admins', count(*) from public.profiles where global_role='admin';
