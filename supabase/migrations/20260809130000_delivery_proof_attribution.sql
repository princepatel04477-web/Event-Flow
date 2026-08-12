-- =====================================================================
-- delivery_proofs: close the attribution gap
-- =====================================================================
-- L1 (TEST-LOG.md, 2026-08-09) found that delivery_proofs is the ONLY
-- attribution-bearing table that never received the 20260808100000
-- treatment. Its eight siblings — guest_groups, call_attempts,
-- travel_legs, call_recordings, room_assignments, trips, messages,
-- import_batches — all have a pair CHECK and app.route_attribution.
-- delivery_proofs had neither, while CLAUDE.md §5.9 cited it as the
-- table that set the precedent.
--
-- Three consequences, all fixed here:
--
--   1. FORGERY. The INSERT policy's first branch
--        captured_by_staff = app.jwt_staff_member_id()
--      says nothing about captured_by, so a team session could set
--      captured_by to ANY auth uid while attributing the staff column to
--      itself. delivery_proofs is insert-only, so such a row can never be
--      corrected. The export reads captured_by_staff and names the staff
--      member; anything reading captured_by names someone else. One
--      immutable row, two answers to "who delivered this hamper".
--
--   2. STALE DEFAULT. captured_by DEFAULTed to app.current_identity(),
--      which returns coalesce(jwt_staff_member_id(), auth.uid()) — a
--      staff_members.id for a code session, which cannot satisfy
--      captured_by's FK to auth.users. Any insert omitting captured_by
--      died with 23503. The only thing preventing that today is one line
--      in src/lib/proof.ts sending an explicit captured_by: null. A
--      second write path (Edge Function, offline replay, backfill) would
--      fail at the moment a staff member is standing at a door.
--
--   3. NO ROUTING. Nothing filled the correct column automatically.
--
-- NOT INCLUDED — the pair CHECK. An audit of the live project on
-- 2026-08-09 found 206 proofs, of which 2 have NEITHER column set and so
-- violate num_nonnulls(captured_by, captured_by_staff) = 1. Those rows
-- cannot be repaired (UPDATE is blocked by trigger) or removed (DELETE
-- likewise), so a plain CHECK cannot be added. See TEST-LOG.md; the
-- decision on how to proceed is Prince's.
--
-- IDEMPOTENT: create or replace, drop trigger if exists, drop policy if
-- exists.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Teach route_attribution about delivery_proofs
-- ---------------------------------------------------------------------
-- Recreated in full (the function dispatches on TG_TABLE_NAME, so a
-- delivery_proofs branch has to be added inside it — attaching the old
-- function to the table would fall straight through to `return NEW` and
-- do nothing at all). The eight existing branches are unchanged.
create or replace function app.route_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := app.current_staff_id();
  v_auth  uuid := app.current_auth_uid();
begin
  -- Attribution is set at INSERT and never re-routed on UPDATE: an UPDATE
  -- that clears a pair (release_group, a correction) must stay cleared, and
  -- re-attributing a row to whoever happened to touch it last would falsify
  -- the audit trail. Only fill pairs that are entirely unset.
  if TG_TABLE_NAME = 'guest_groups' then
    if TG_OP = 'INSERT' then
      if NEW.locked_by is null and NEW.locked_by_staff is null then
        if v_staff is not null then NEW.locked_by_staff := v_staff;
        else NEW.locked_by := v_auth; end if;
      end if;
    end if;
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'call_attempts' then
    if NEW.caller_id is null and NEW.caller_id_staff is null then
      if v_staff is not null then NEW.caller_id_staff := v_staff;
      else NEW.caller_id := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'travel_legs' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'call_recordings' then
    if NEW.uploaded_by is null and NEW.uploaded_by_staff is null then
      if v_staff is not null then NEW.uploaded_by_staff := v_staff;
      else NEW.uploaded_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'room_assignments' then
    if NEW.assigned_by is null and NEW.assigned_by_staff is null then
      if v_staff is not null then NEW.assigned_by_staff := v_staff;
      else NEW.assigned_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'trips' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'messages' then
    if NEW.created_by is null and NEW.created_by_staff is null then
      if v_staff is not null then NEW.created_by_staff := v_staff;
      else NEW.created_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  if TG_TABLE_NAME = 'import_batches' then
    if NEW.imported_by is null and NEW.imported_by_staff is null then
      if v_staff is not null then NEW.imported_by_staff := v_staff;
      else NEW.imported_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  -- NEW: delivery_proofs. Same shape as the siblings — fill only when the
  -- pair is entirely unset, so an explicit captured_by: null from
  -- src/lib/proof.ts is still routed to the staff column rather than
  -- being overwritten.
  if TG_TABLE_NAME = 'delivery_proofs' then
    if NEW.captured_by is null and NEW.captured_by_staff is null then
      if v_staff is not null then NEW.captured_by_staff := v_staff;
      else NEW.captured_by := v_auth; end if;
    end if;
    return NEW;
  end if;

  return NEW;
end;
$$;

-- INSERT only. delivery_proofs has no UPDATE path (app.block_mutation),
-- so an UPDATE branch would be unreachable.
drop trigger if exists delivery_proofs_route_attribution on public.delivery_proofs;
create trigger delivery_proofs_route_attribution
  before insert on public.delivery_proofs
  for each row execute function app.route_attribution();

-- ---------------------------------------------------------------------
-- 2. Drop the stale current_identity() defaults
-- ---------------------------------------------------------------------
-- Routing now lives in the trigger, which can target the correct column.
-- A default cannot: it wrote a staff id into captured_by, whose FK points
-- at auth.users (the original 23503).
alter table public.delivery_proofs alter column captured_by       drop default;
alter table public.delivery_proofs alter column captured_by_staff drop default;

-- ---------------------------------------------------------------------
-- 3. Close the forgery hole in the INSERT policy
-- ---------------------------------------------------------------------
-- Only the `captured_by is null` addition is new. The staff-identity gate
-- is deliberately left as it was: has_staff_identity() requires a
-- staff_member_id claim, which an admin auth session does not carry, so
-- proofs must come from a field staff identity. That also makes the
-- second branch unreachable today — it is kept so the policy stays
-- correct if that gate is ever relaxed.
drop policy if exists delivery_proofs_ins on public.delivery_proofs;
create policy delivery_proofs_ins on public.delivery_proofs
  for insert to authenticated
  with check (
    app.is_staff(event_id)
    and app.has_staff_identity(event_id)
    and (
      (captured_by_staff = app.jwt_staff_member_id() and captured_by is null)
      or (captured_by_staff is null and captured_by = auth.uid())
    )
  );

comment on column public.delivery_proofs.captured_by is
  'Auth uid of the capturing admin. Mutually exclusive with '
  'captured_by_staff — a code-auth session has no auth.uid(). Routed by '
  'app.route_attribution on insert; never defaulted.';
comment on column public.delivery_proofs.captured_by_staff is
  'staff_members.id of the capturing team member. Mutually exclusive with '
  'captured_by. Routed by app.route_attribution on insert.';
