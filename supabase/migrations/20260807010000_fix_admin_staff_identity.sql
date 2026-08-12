-- =====================================================================
-- 2000 FIX — admin sessions regain staff identity for writes
--
-- REGRESSION: the 1901 RLS rewrite gated every staff-policy INSERT/UPDATE
-- on app.has_staff_identity(event_id), which requires JWT claims
-- (event_id + staff_member_id) that only a CODE session carries. A real
-- admin (email/password, auth.uid() present, app.is_admin() true) has no
-- such claims, so has_staff_identity returned FALSE and every admin write
-- (room_assignments, guest_groups, deliverables, ...) was rejected with
-- 42501 before the capacity/overlap triggers could ever fire. T0.6's
-- "permission error where 23514 belongs" is this exact policy.
--
-- FIX: an admin IS their own identity — a real auth.uid() with the
-- global admin role. has_staff_identity now returns true for a genuine
-- admin, restoring writes. This does NOT weaken the code-session rule:
-- team/client still have no auth.uid() and MUST pick a staff member
-- (staff_member_id claim) or the gate stays false. The capacity trigger
-- (guard_room_capacity, 23514) and the overlap guard are untouched.
--
-- IDEMPOTENT: create or replace function.
-- =====================================================================
create or replace function app.has_staff_identity(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_admin()
      or (
        (app.jwt_event_id() = p_event_id)
        and (app.jwt_staff_member_id() is not null)
        and exists (
          select 1 from public.staff_members sm
          where sm.id = app.jwt_staff_member_id()
            and sm.event_id = p_event_id
            and sm.is_active
        )
      );
$$;

grant execute on function app.has_staff_identity(uuid) to authenticated;
