-- =====================================================================
-- public.event_board(p_event_id): the dashboard board row, checked ONCE.
--
-- Why: v_event_board is security_invoker, so every subquery in it re-applies
-- the base tables' RLS, `app.is_staff(event_id)`, to EVERY row it counts.
-- is_staff is a SECURITY DEFINER SQL function with a pinned search_path, so
-- Postgres cannot inline it. Each call runs the whole chain (is_admin →
-- profiles lookup, jwt_event_id / jwt_app_role → auth.jwt() JSON parse,
-- code_is_live → event_access_codes lookup), about 0.45 ms per row.
-- Measured on EventFlow-IN for SAMPLE2026 (819 families), as a team session:
--   v_event_board via RLS   2,708 ms   (six ~375 ms passes over guest_groups)
--   same query, no RLS          2.6 ms
-- PostgREST's statement_timeout for `authenticated` is 8 s, so a busy moment
-- turns a 3 s read into a timeout. readBoard() then answers null, and the
-- dashboard shows "Some counters could not be read" (BUG-HUNT-2026-10-25).
--
-- What this does: the same check, asked once. Every row the view counts is
-- already fenced to `event_id = p_event_id`, so `app.is_staff(p_event_id)`
-- answers exactly what the per-row RLS answers for each of them. Not staff →
-- zero rows (the app treats that as "no board" and uses its fallback). It
-- returns aggregates only — counts, no row data — the same columns the view
-- already exposes to staff.
--
-- Runs as the owner (postgres, BYPASSRLS), which is what removes the per-row
-- cost. Treat any edit here as a security change: `app.is_staff(p_event_id)`
-- is the only fence, as `where app.is_member(...)` is for
-- client_guest_profiles (CLAUDE.md §8).
--
-- The RLS policies are untouched. Every other read still pays the per-row
-- cost; the general fix (policies of the form
-- `event_id in (select app.staff_event_ids())`) is a wider change and is
-- left for after the event. See DECISIONS.md, 25 October 2026.
-- =====================================================================

create or replace function public.event_board(p_event_id uuid)
returns setof public.v_event_board
language sql
stable
security definer
set search_path = ''
as $$
  select b.*
  from public.v_event_board b
  where b.event_id = p_event_id
    and app.is_staff(p_event_id);
$$;

revoke all on function public.event_board(uuid) from public, anon;
grant execute on function public.event_board(uuid) to authenticated;
