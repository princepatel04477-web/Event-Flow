-- =====================================================================
-- route_context(): ONE round trip for the three facts every staff route
-- resolves before it can render — the event row, the viewer's access and
-- the viewer's department.
--
-- WHY. src/app/(app)/v2/[eventCode]/layout.tsx and its page each await
-- resolveEventByCode -> requireSection -> getEventAccess one after another
-- (src/lib/supabase/queries.ts, src/lib/auth/section-guard.ts). From India
-- each hop is a trip to Seoul, so the guard work alone puts several
-- sequential round trips in front of a screen that renders in one
-- (docs/FEEL-BASELINE.md, S2). This answers all of it in one call.
--
-- SECURITY INVOKER, deliberately. The `events` read runs under the caller's
-- OWN RLS, so an event the viewer cannot see returns NO ROW — exactly the
-- null resolveEventByCode already returns, and the same tenancy fence
-- (CLAUDE.md §5.1). Nothing here widens access.
--
-- ACCESS is computed from the same three inputs getEventAccess() uses —
-- app.is_admin(), the code-auth claims, event_members.role — so the app and
-- the database cannot disagree, including for a deactivated admin (whose
-- app.is_admin() is false) and for a revoked code (app.code_is_live()).
--
-- NOTE ON "SECTION LOCKS". No such thing exists in this schema: what gates
-- a screen is the viewer's DEPARTMENT (src/lib/departments.ts,
-- DEPARTMENT_SECTIONS), which is a JWT claim mirrored on staff_members.
-- This function returns the department, which is the real answer; there is
-- no lock table to return.
--
-- NOT APPLIED by this commit. Until it is, src/lib/route-context.ts
-- feature-detects its absence once and falls back to the three existing
-- calls, so this is safe to deploy first.
-- =====================================================================

create or replace function public.route_context(p_event_code text)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.id, e.code, e.name, e.starts_on, e.ends_on, e.venue_city
    from public.events e
    -- Case-insensitive, matching resolveEventByCode()'s exact-then-upper
    -- retry but broader: a hand-typed lower-case code resolves too.
    where lower(e.code) = lower(p_event_code)
    limit 1
  ),
  acc as (
    select
      case
        when app.is_admin() then 'admin'
        when exists (
          select 1 from ev
          where app.jwt_event_id() = ev.id
            and app.jwt_app_role() = 'team'
            and app.code_is_live()
        ) then 'event_team'
        when exists (
          select 1 from ev
          where app.jwt_event_id() = ev.id
            and app.jwt_app_role() = 'client'
            and app.code_is_live()
        ) then 'client'
        when exists (
          select 1
          from public.event_members em
          join public.profiles p on p.id = em.user_id
          where em.event_id = (select id from ev)
            and em.user_id = auth.uid()
            -- is_active, because the database already fences a deactivated
            -- member out (is_member() routes non-admins through is_admin(),
            -- which requires it). Without this the app would label them
            -- event_team on a screen they can read nothing from — a confident
            -- lie, which is the one thing getEventAccess exists to prevent.
            and p.is_active is true
            and em.role = 'event_team'
        ) then 'event_team'
        when exists (
          select 1
          from public.event_members em
          join public.profiles p on p.id = em.user_id
          where em.event_id = (select id from ev)
            and em.user_id = auth.uid()
            and p.is_active is true
            and em.role = 'client'
        ) then 'client'
        else 'none'
      end as access
  )
  select
    case
      -- No row means "you cannot see this event" OR "no such event" —
      -- indistinguishable on purpose, exactly as resolveEventByCode has it.
      when (select id from ev) is null then null
      when (select access from acc) = 'none' then null
      else jsonb_build_object(
        -- The WHOLE row, not a hand-picked subset: the app seeds this into the
        -- same per-request memo `resolveEventByCode` reads, and a caller that
        -- reads a column this function dropped would silently get undefined.
        -- Every column here is already readable under the caller's own RLS.
        'event', (select to_jsonb(ev) from ev),
        'access', (select access from acc),
        'department',
          case
            -- An admin has no department; getStaffViewerContext() answers
            -- 'management' for them, so this must too.
            when (select access from acc) = 'admin' then 'management'
            -- The code-auth JWT carries the department set at pick-staff;
            -- fall back to the staff_members row it names.
            else coalesce(
              nullif(auth.jwt() ->> 'department', ''),
              (
                select sm.department::text
                from public.staff_members sm
                where sm.id = app.jwt_staff_member_id()
                  and sm.event_id = (select id from ev)
                  and sm.is_active
              )
            )
          end
      )
    end;
$$;

comment on function public.route_context(text) is
  'One-call route context for a staff route: the event row, the viewer '
  'access (admin|event_team|client) and the viewer department. Returns null '
  'when the viewer cannot see the event. Mirrors getEventAccess() and '
  'getStaffViewerContext() in the app. SECURITY INVOKER: the events read is '
  'fenced by the caller''s own RLS.';

grant execute on function public.route_context(text) to authenticated, anon;
