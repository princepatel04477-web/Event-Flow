-- =====================================================================
-- A7 - RSVP BREAKDOWN BY CONFIRMATION BUCKET
--
-- The admin dashboard gained five confirmation tabs (Confirmed, Not coming,
-- Maybe, No answer, Not called), each showing PAX + family count + the list.
-- One row per family, with the PAX the rest of the app already uses
-- (confirmed_pax, falling back to expected_pax) and the bucket the tab reads.
--
-- SECURITY. `security_invoker = true`, exactly like `v_event_board`
-- (20260809120000): this runs as the CALLER, so `guest_groups` RLS applies and
-- a client session (is_member, not is_staff) sees nothing. No policy is
-- touched; this is additive.
--
-- BUCKETS are exhaustive over app.rsvp_status so no family can vanish from
-- every tab:
--   confirmed            -> 'confirmed'
--   declined             -> 'not_coming'
--   tentative            -> 'maybe'
--   unreachable,attempted-> 'no_answer'
--   everything else      -> 'not_called'  (not_started, null, and callback:
--                           a family that asked to be called back has still not
--                           given an answer, so it is outstanding work)
-- =====================================================================

create or replace view public.v_event_rsvp_buckets
with (security_invoker = true) as
select
  g.event_id,
  g.id as group_id,
  coalesce(nullif(btrim(g.head_name), ''), 'Unnamed family') as head_name,
  coalesce(g.confirmed_pax, g.expected_pax, 0) as pax,
  case
    when g.rsvp_status = 'confirmed' then 'confirmed'
    when g.rsvp_status = 'declined' then 'not_coming'
    when g.rsvp_status = 'tentative' then 'maybe'
    when g.rsvp_status in ('unreachable', 'attempted') then 'no_answer'
    else 'not_called'
  end as bucket
from public.guest_groups g;

grant select on public.v_event_rsvp_buckets to authenticated;
