-- Route-load performance indexes (Problem 2 of the nav/perf pass).
--
-- Measured baseline (client-side wall time over Supabase cloud, ap-northeast-2):
--   deliveries :: readDeliveryRun  1325ms
--   logistics :: readData(arrival) 1197ms
--   rooms     :: readRoomsGrid     1200ms
--   fleet     :: readFleet          803ms
--
-- The four slowest routes share a shape: a filter on event_id plus a sort on
-- a second column, where the existing index covers event_id but not the sort
-- column (Postgres then sorts in memory) — or a filter column with no index
-- at all. These are additive indexes in the same idiom as the existing
-- migrations (plain `create index if not exists`, safe inside the migration
-- transaction); none change a query plan that is already correct.

-- readFleet orders vehicles by created_at and vehicle_types by sort_order.
create index if not exists vehicles_event_created_idx
  on public.vehicles (event_id, created_at);
create index if not exists vehicle_types_event_sort_idx
  on public.vehicle_types (event_id, sort_order);

-- readDeliveryRun filters deliverables by event_id and orders by room_id;
-- the existing (event_id, room_id) index already serves it. What is missing
-- is the hotels side of the nested join: hotels(event_id) for the rooms
-- lookup is the PK path, but a covering index on hotels(event_id, id, name)
-- keeps the join from touching the heap.
create index if not exists hotels_event_idx
  on public.hotels (event_id, name);

-- readUnplacedTravelLegs excludes placed legs by scanning trip_passengers
-- filtered on event_id — no index supports that filter today (the only index
-- is on travel_leg_id). Adding (event_id, travel_leg_id) turns the
-- exclusion scan into an index range scan.
create index if not exists trip_passengers_event_leg_idx
  on public.trip_passengers (event_id, travel_leg_id);

-- room_assignments is filtered by event_id + released_at on every board
-- (rooms, checkin, arrivals, departures); the existing
-- room_assignments_active_by_room is on (room_id) where released_at is null,
-- so the event_id filter is a scan. Cover the common read.
create index if not exists room_assignments_event_active_idx
  on public.room_assignments (event_id, released_at);
