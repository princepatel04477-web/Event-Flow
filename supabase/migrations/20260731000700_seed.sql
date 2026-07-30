-- =====================================================================
-- 0700 SEED — global templates (event_id null), copied per event on demand
-- =====================================================================

-- Vehicle capacity = people carried WITH luggage, exactly as you gave me.
-- The team can always override per vehicle on the day.
insert into public.vehicle_types (event_id, name, seat_label, default_capacity, sort_order)
values
  (null, 'Sedan',                  '4-seater',  3,  10),
  (null, 'SUV (Ertiga / Innova)',  '7-seater',  4,  20),
  (null, 'Tempo Traveller 17',     '17-seater', 14, 30),
  (null, 'Tempo Traveller 20',     '20-seater', 17, 40),
  (null, 'Tempo Traveller 24',     '24-seater', 20, 50),
  (null, 'Tempo Traveller 33',     '33-seater', 29, 60),
  (null, 'Bus 34',                 '34-seater', 30, 70),   -- CONFIRM real number
  (null, 'Bus 56',                 '56-seater', 50, 80)    -- CONFIRM real number
on conflict do nothing;

comment on table public.vehicle_types is
  'Bus 34 and Bus 56 luggage-adjusted capacities are estimates. Confirm with '
  'your transport vendor and update before the first dispatch.';

insert into public.message_templates (event_id, key, category, language, body, variables)
values
  (null, 'rsvp_invite', 'rsvp', 'en',
   'Namaste {{head_name}}, you are invited to {{event_name}}. Our team will call you shortly to confirm your travel details. — {{event_name}} Team',
   '["head_name","event_name"]'::jsonb),

  (null, 'rsvp_confirmed', 'rsvp', 'en',
   'Thank you {{head_name}}. We have noted {{pax}} guest(s) arriving on {{arrival_date}} by {{arrival_mode}}. See you soon!',
   '["head_name","pax","arrival_date","arrival_mode"]'::jsonb),

  (null, 'room_allocated', 'rooms', 'en',
   '{{head_name}}, your stay is confirmed at {{hotel_name}}, Room {{room_number}}. Check-in from {{check_in_time}}.',
   '["head_name","hotel_name","room_number","check_in_time"]'::jsonb),

  (null, 'pickup_details', 'logistics', 'en',
   '{{head_name}}, your pickup is arranged for {{arrival_date}} at {{arrival_time}} from {{pickup_point}}. Driver: {{driver_name}}, {{driver_mobile}}.',
   '["head_name","arrival_date","arrival_time","pickup_point","driver_name","driver_mobile"]'::jsonb),

  (null, 'departure_details', 'logistics', 'en',
   '{{head_name}}, your drop is arranged for {{departure_date}} at {{departure_time}} to {{drop_point}}. Driver: {{driver_name}}, {{driver_mobile}}.',
   '["head_name","departure_date","departure_time","drop_point","driver_name","driver_mobile"]'::jsonb)
on conflict do nothing;

-- ---------------------------------------------------------------------
-- BOOTSTRAP (run once, by hand, after you and your friend sign up)
--
--   update public.profiles set global_role = 'admin'
--    where id in (select id from auth.users where email in ('you@x.com','friend@x.com'));
--
-- Then create an event, then create the event_team and client logins in
-- Supabase Auth, then grant them:
--
--   insert into public.event_members (event_id, user_id, role)
--   values ('<event-uuid>', '<user-uuid>', 'event_team');
-- ---------------------------------------------------------------------
