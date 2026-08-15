-- =====================================================================
-- FLEET RLS FIX — align the fleet tables with the current policy shape.
--
-- 20260815120000 created the fleet tables and attached RLS via
-- app.apply_staff_policies(), whose 1901 body still carries the
-- has_staff_identity conjunct. 20260814140000 removed that conjunct from
-- the 17 existing tables by creating new policies INLINE (it did not edit
-- apply_staff_policies), so the fleet tables ended up with the OLD gated
-- shape: an authenticated team session with no staff_member_id claim could
-- read but NOT write them.
--
-- This migration rewrites the four fleet tables' policies to match the
-- CURRENT live shape (app.is_staff(event_id) only, no identity gate), the
-- same shape 20260814140000 produced for every sibling table.
--
-- IDEMPOTENT: drop policy if exists / create policy.
-- =====================================================================

do $$
declare
  t text;
  tables text[] := array['vehicles', 'drivers', 'vehicle_assignments', 'odometer_logs'];
begin
  foreach t in array tables loop
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (app.is_staff(event_id))', t || '_ins', t);

    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (app.is_staff(event_id))
         with check (app.is_staff(event_id))', t || '_upd', t);
  end loop;
end $$;
