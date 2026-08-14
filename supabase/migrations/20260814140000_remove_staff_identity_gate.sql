-- Remove the staff-identity write gate.
--
-- REQUESTED CHANGE, MADE WITH EYES OPEN. This reverses a rule CLAUDE.md §5.9
-- lists as non-negotiable. Recording what it costs, because the cost is not
-- visible from the app and is not reversible for rows written afterwards.
--
-- Before this migration, every insert/update policy on 18 tables read
--   app.is_staff(event_id) AND app.has_staff_identity(event_id)
-- and `has_staff_identity` required a `staff_member_id` JWT claim, minted only
-- by tapping a name on /pick-staff. An event with no staff_members rows was
-- therefore fully readable and completely unwritable.
--
-- WHAT IS LOST
--   * "Who did this" stops being answerable for any row written by a team
--     session from now on. A shared team code has no auth.uid() and now no
--     staff id either, so caller_id, captured_by, assigned_by, imported_by and
--     every _staff sibling are simply null. The audit_log still records the
--     change and its timestamp; it cannot record a person.
--   * delivery_proofs are insert-only and immutable by trigger, so a proof
--     written without attribution can never be corrected. Photo proof
--     continues to prove a delivery happened; it no longer proves who made it.
--   * The call_attempts CHECK that guaranteed exactly one of
--     (caller_id, caller_id_staff) was set is relaxed to "at most one".
--
-- WHAT IS DELIBERATELY KEPT
--   * Tenancy. app.is_staff(event_id) still fences every policy, so nothing
--     here lets one event read or write another, and a client still writes
--     nothing. This migration removes the identity requirement, not the fence.
--   * Anti-forgery on the pairs. Where an attribution column IS populated it
--     must still match the caller (auth.uid() / jwt staff id). Null is now
--     allowed; lying is not.
--   * Insert-only delivery_proofs, the server-clock triggers, and every
--     block_mutation trigger. Untouched.

begin;

-- ---------------------------------------------------------------------------
-- 1. Drop the identity conjunct from the 17 uniform tables (ins + upd).
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'call_attempts', 'call_recordings', 'deliverables', 'guest_groups',
    'guests', 'hotels', 'import_batches', 'import_rows', 'messages',
    'room_assignments', 'rooms', 'rsvp_extractions', 'transcripts',
    'travel_legs', 'trip_passengers', 'trips', 'vehicles'
  ];
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

-- ---------------------------------------------------------------------------
-- 2. delivery_proofs — insert only, and its own shape.
--
-- The old policy demanded the row carry an identity matching the caller. Now
-- both columns may be null, but a non-null one must still be the caller's own:
-- allowing null is the requested change, allowing forgery is not.
-- ---------------------------------------------------------------------------
drop policy if exists delivery_proofs_ins on public.delivery_proofs;
create policy delivery_proofs_ins on public.delivery_proofs
  for insert to authenticated
  with check (
    app.is_staff(event_id)
    and (captured_by is null or captured_by = auth.uid())
    and (captured_by_staff is null or captured_by_staff = app.jwt_staff_member_id())
  );

-- ---------------------------------------------------------------------------
-- 3. Relax the two "exactly one" attribution CHECKs to "at most one".
--
-- These sit BELOW RLS, so leaving them would reject the insert regardless of
-- policy — the gate would look removed and call logging would still fail with
-- a constraint violation instead of a permission error.
-- ---------------------------------------------------------------------------
alter table public.call_attempts drop constraint if exists call_attempts_caller_one_of;
alter table public.call_attempts add constraint call_attempts_caller_one_of
  check (num_nonnulls(caller_id, caller_id_staff) <= 1);

alter table public.delivery_proofs drop constraint if exists delivery_proofs_captured_by_one_of;
alter table public.delivery_proofs add constraint delivery_proofs_captured_by_one_of
  check (num_nonnulls(captured_by, captured_by_staff) <= 1) not valid;

-- ---------------------------------------------------------------------------
-- 4. Make the caller lock survive having no identity.
--
-- claim_group stamps locked_by/locked_by_staff from the caller. With no
-- identity both are null, and every predicate that compares them is then
-- `null = null` -> NULL -> false. Consequences if left alone:
--   * release_group matches nothing, so a lock NEVER clears early;
--   * the holder cannot even re-claim their own group.
-- Every family opened on the RSVP status screen would freeze for the full 15
-- minutes with no way out, which is strictly worse than the documented
-- "wait 15 minutes, no manual override" in CLAUDE.md §11b.
--
-- With attribution gone there is nothing left to identify a holder by, so the
-- lock becomes cooperative: an unowned lock may be claimed or released by any
-- staff member on that event. It still serialises the common case (two people
-- opening the same family notice each other) and it still expires.
-- ---------------------------------------------------------------------------
create or replace function public.claim_group(p_group_id uuid, p_minutes integer default 15)
returns public.guest_groups
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_group public.guest_groups;
begin
  update public.guest_groups g
     set locked_by       = case when app.current_staff_id() is not null then null else app.current_auth_uid() end,
         locked_by_staff = case when app.current_staff_id() is not null then app.current_staff_id() else null end,
         locked_until    = now() + make_interval(mins => p_minutes),
         updated_at      = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_until is null
          or g.locked_until < now()
          or g.locked_by = app.current_identity()
          or g.locked_by_staff = app.current_staff_id()
          -- Unowned lock: nobody can be identified as the holder, so nobody
          -- can be excluded. Without this an anonymous team session cannot
          -- reclaim the group it just locked itself.
          or (g.locked_by is null and g.locked_by_staff is null))
  returning * into v_group;

  if v_group.id is null then
    raise exception 'Group % is locked by another caller right now.', p_group_id
      using errcode = '55P03';
  end if;

  return v_group;
end;
$function$;

create or replace function public.release_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  update public.guest_groups g
     set locked_by = null, locked_by_staff = null, locked_until = null, updated_at = now()
   where g.id = p_group_id
     and app.is_staff(g.event_id)
     and (g.locked_by = app.current_identity()
          or g.locked_by_staff = app.current_staff_id()
          -- See claim_group. Note this does NOT restore the `or app.is_admin()`
          -- branch removed by 20260813000000 (tests/l4_lock_release.sql): an
          -- OWNED lock is still only releasable by its holder or by expiry.
          or (g.locked_by is null and g.locked_by_staff is null));
end;
$function$;

commit;

-- app.has_staff_identity() is intentionally left in place, now unreferenced by
-- any policy. Dropping it would break any future migration or test that still
-- names it, and an unused security-definer function that only ever returns a
-- boolean is not a liability. It is the one-line switch to restore this gate.
