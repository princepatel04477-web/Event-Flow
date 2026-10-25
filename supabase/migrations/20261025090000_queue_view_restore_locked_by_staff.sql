-- =====================================================================
-- v_rsvp_queue: restore locked_by_staff (BUG-HUNT-2026-10-25 #2)
--
-- 20260808110000 added gg.locked_by_staff to the view. 20260812000000
-- (presence columns) then dropped and recreated the view WITHOUT it, while
-- its own comment says the column is there. Nothing noticed, because every
-- reader used select('*') and got `undefined` for the lock holder — until
-- 6415806 (7 Oct) narrowed v2's Call next screen to an explicit column list
-- naming locked_by_staff. PostgREST then answers 400 / 42703 and the screen
-- shows "Could not load the calling list" on every load.
--
-- CREATE OR REPLACE, not drop + create: Postgres allows new columns only at
-- the END of an existing view's column list, and appending keeps the grant
-- and anything that depends on the view. Every existing column is repeated
-- exactly, in its existing order; locked_by_staff goes last.
-- =====================================================================

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
  gg.locked_by_staff
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
