-- Performance indexes for the slow reads (measured with EXPLAIN ANALYZE,
-- 2026-08-07, SAMPLE2026 = 4 families / 67 guests, live project).
--
-- DIAGNOSIS (all on the live DB):
--   /guests     client_guest_profiles: seq scan guests + TWO lateral seq
--               scans on travel_legs per guest + ONE lateral seq scan on
--               deliverables per guest. The lateral filters are
--               (group_id, direction) and (group_id, kind) — NO index serves
--               either, so every guest triggers full-table scans. This is the
--               2.2s: it scales ~linearly with families x table size.
--   /rooms      readRoomsGrid: seq scan rooms + in-memory sort on
--               room_number. Index (event_id, hotel_id) does not cover the
--               sort column.
--   /deliveries readDeliveryRun: seq scan deliverables (event_id filter),
--               hash joins into guest_groups/rooms/hotels (each seq scanned).
--   /rsvp       v_rsvp_queue: seq scan guest_groups + per-group bitmap probe
--               on call_attempts (group_id) — the call_attempts side is
--               already indexed; the guest_groups scan is the cost.
--   /allocate   suggestRoomAssignments: ALREADY index-backed
--               (guest_groups_event_id_rsvp_status_idx). No change needed.
--
-- FIX: additive indexes only. No schema, view, RPC, or RLS change. The
-- lateral subqueries in client_guest_profiles (a view we must NOT alter) are
-- served directly by the two (group_id, ...) indexes below.

-- Serves the two travel_legs laterals in client_guest_profiles:
--   WHERE group_id = X AND direction = 'arrival' ORDER BY travel_date, time
create index if not exists travel_legs_group_direction_idx
  on public.travel_legs (group_id, direction, travel_date, travel_time);

-- Serves the two deliverables laterals in client_guest_profiles:
--   WHERE group_id = X AND kind = 'hamper' (aggregate)
create index if not exists deliverables_group_kind_idx
  on public.deliverables (group_id, kind);

-- Serves readRoomsGrid's sort: WHERE event_id = X ORDER BY room_number.
create index if not exists rooms_event_room_number_idx
  on public.rooms (event_id, room_number);

-- Serves the deliverable room join in readDeliveryRun: WHERE event_id = X
-- ORDER BY room_id (the existing deliverables_event_room_idx already covers
-- (event_id, room_id) — kept for the room_id sort; nothing new needed here,
-- the guest_groups join below is the missing one).

-- v_rsvp_queue scans guest_groups by event_id; the existing
-- guest_groups_event_status_idx covers event_id + rsvp_status but the view
-- orders by priority; a covering (event_id, priority) helps the sort.
create index if not exists guest_groups_event_priority_sort_idx
  on public.guest_groups (event_id, priority);
