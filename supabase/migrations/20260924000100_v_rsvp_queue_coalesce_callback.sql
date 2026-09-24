-- =====================================================================
-- M10: Restore coalesce(gg.callback_at, c.next_callback_at) and
-- adults_confirmed/children_confirmed in v_rsvp_queue.
--
-- Migration 20260806100000 added callback_at coalesce and adult/child
-- columns. Subsequent migrations recreated the view without them.
-- This additive migration drops and recreates v_rsvp_queue with security_invoker.
-- =====================================================================

drop view if exists public.v_rsvp_queue cascade;

create view public.v_rsvp_queue
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
  gg.adults_confirmed,
  gg.children_confirmed,
  gg.rsvp_status,
  gg.priority,
  gg.remarks,
  gg.locked_by,
  gg.locked_by_staff,
  gg.locked_until,
  (gg.locked_until is not null and gg.locked_until > now()) as is_locked,
  coalesce(c.attempts, 0)  as attempt_count,
  c.last_attempt_at,
  c.last_outcome,
  coalesce(gg.callback_at, c.next_callback_at) as next_callback_at,
  -- Soft presence columns
  gg.last_opened_by_staff,
  gg.last_opened_at,
  sm.full_name as last_opened_by_name
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
