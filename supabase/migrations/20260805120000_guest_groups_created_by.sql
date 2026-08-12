-- =====================================================================
-- 1200 FIX: guest_groups is missing created_by
-- =====================================================================
-- Migration 0010/0011 made commit_guest_import() write `created_by` on
-- every guest_groups insert, but the column was never added to the table
-- (it exists on guests, travel_legs and call_attempts, and the 0200
-- migration that created guest_groups simply left it off). Every import
-- therefore failed with:
--
--   ERROR: 42703: column "created_by" of relation "guest_groups"
--   does not exist
--
-- The whole commit rolled back as one transaction, so not a single batch
-- ever landed — import_batches stays empty and the calling queue never
-- fills. Add the column exactly as the sibling tables declare it.
-- =====================================================================

alter table public.guest_groups
  add column if not exists created_by uuid references auth.users (id) default auth.uid();
