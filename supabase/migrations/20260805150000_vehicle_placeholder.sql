-- =====================================================================
-- 1500 R3: vehicle placeholder markers
-- =====================================================================
-- The luggage-adjusted capacities are already the ONLY number the fleet
-- uses (`vehicles.capacity` / `vehicle_types.default_capacity` are
-- documented "People carried WITH luggage"). What was missing is the
-- honesty marker the R3 spec demands: `is_placeholder`, default true, so
-- every capacity entered through the seed/quick-add starts flagged and the
-- UI shows a warning until a human confirms the number with the vendor.
--
-- IDEMPOTENCY: the column is added IF NOT EXISTS so this migration can be
-- pushed repeatedly over a live database.
-- =====================================================================

alter table public.vehicles
  add column if not exists is_placeholder boolean not null default true;

comment on column public.vehicles.is_placeholder is
  'True until a human confirms this capacity with the transport vendor. The UI shows a warning while any vehicle is flagged.';

-- Seed rows (and anything the fleet UI created before this migration) are
-- placeholders by definition — they were never vendor-confirmed.
