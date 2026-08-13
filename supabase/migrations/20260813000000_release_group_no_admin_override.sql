-- =====================================================================
-- release_group: drop the `or app.is_admin()` override
-- =====================================================================
-- WHAT WAS WRONG
--
-- release_group's WHERE clause was:
--
--     and (g.locked_by       = app.current_identity()
--       or g.locked_by_staff = app.current_staff_id()
--       or app.is_admin())            <-- this line
--
-- That third branch makes the RPC release ANY caller's lock whenever the
-- session belongs to an admin. It is not a lock-holder check at all; it is
-- an unconditional override, and nothing in the signature says so. Any
-- call site that fires release_group "just in case" therefore behaves
-- completely differently for an admin than for everyone else.
--
-- Reproduced on a scratch database built from these migrations
-- (tests/repro_admin_lock_release.sql, Postgres 17.6.1.155):
--
--   C0  caller A claims the family .......................... caller-A
--   R1  a non-admin colleague calls release_group ........... caller-A  (no-op, correct)
--   C1  the next session really is an admin ................. true
--   R2  the ADMIN calls release_group ....................... unlocked  <-- A's lock is gone
--   R4  the admin releases a lock the admin DOES hold ....... unlocked  (correct)
--
-- R1 is the control that isolates the cause: R1 and R2 are both staff and
-- neither holds the lock; the only difference between them is is_admin().
--
-- WHY REMOVING IT IS SAFE
--
-- release_group has exactly one consumer in the application:
-- `releaseGroupAfterCall` in src/lib/actions/call.ts, called from the RSVP
-- status screen after a successful save — and that call site already
-- guards on the session holding the lock before calling. No code path
-- relies on the override. R4 above proves an admin releasing their OWN
-- lock still works after this change, because `locked_by =
-- app.current_identity()` resolves to the admin's auth.uid().
--
-- WHAT THIS DOES NOT FIX
--
-- An unawaited release racing a subsequent claim by the SAME caller still
-- wipes that caller's own lock — the holder check passes in that case, by
-- construction. Ordering at the call site is the only fix for that; do not
-- expect this migration to cover it.
--
-- An admin who genuinely needs to break a stuck lock has the 15-minute
-- expiry, and can be given an explicit, named RPC. A silent branch inside
-- the ordinary release path is not that feature.
-- =====================================================================

create or replace function public.release_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Release ONLY a lock this session actually holds. An admin is not
  -- special here: being an admin is not the same as being the holder.
  update public.guest_groups g
     set locked_by       = null,
         locked_by_staff = null,
         locked_until    = null,
         updated_at      = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_by       = app.current_identity()
          or g.locked_by_staff = app.current_staff_id());
end;
$$;

grant execute on function public.release_group(uuid) to authenticated;

comment on function public.release_group(uuid) is
  'Drops the caller lock on a group, but ONLY when the calling session is '
  'the holder. Deliberately has no admin override: see migration '
  '20260813000000. Silently affects zero rows when the caller does not '
  'hold the lock, so callers must re-read the row rather than trusting '
  'the absence of an error.';
