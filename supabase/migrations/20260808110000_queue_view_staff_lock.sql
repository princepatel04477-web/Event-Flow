-- =====================================================================
-- 2101 v_rsvp_queue exposes locked_by_staff for the attribution split.
--
-- 2100 added locked_by_staff (team sessions claim via the staff column).
-- The queue view must expose it so any "who locked this" display can
-- resolve whichever column is populated. is_locked already keys off
-- locked_until, so it is unaffected.
--
-- IDEMPOTENT: drop view if exists (column set changed — create or replace
-- cannot add a column to an existing view), then create.
-- =====================================================================
drop view if exists public.v_rsvp_queue;
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
