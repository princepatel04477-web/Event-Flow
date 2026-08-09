-- =====================================================================
-- 1901 CODE-BASED AUTH — RLS REWRITE
--
-- Re-derives every policy from the JWT claims minted by
-- verify-access-code (event_id, app_role, access_code_id,
-- staff_member_id) instead of auth.uid() → profiles/event_members.
--
-- WHAT IS PRESERVED (do not weaken):
--   * force row level security on every table
--   * delivery_proofs / call_recordings / extraction_field_reviews
--     insert-only (triggers untouched; grants re-asserted)
--   * deletes admin-only everywhere
--   * client sees ZERO base-table rows (only client_guest_profiles)
--   * cross-event access impossible (event_id from claim, checked per row)
--   * admin = real auth.users row with global_role admin (email/password)
--
-- WHAT CHANGES:
--   * team/client identity comes from the claim, not event_members
--   * INSERT/UPDATE on operational tables now ALSO requires a selected
--     staff member (has_staff_identity) — an unattributed write is blocked
--   * delivery_proofs.captured_by records the selected staff member
--     (there is no auth.uid() in a code session)
--   * guard_profile_role's null-uid bootstrap only applies to a session
--     with NO claims (true SQL-editor/service context), never to a
--     code-auth session — closing the escalation hole
--   * the new code-auth tables are locked down: access codes admin-only,
--     staff list admin-manage + team-read, logs admin-read
--
-- IDEMPOTENT: drop policy if exists / create policy, create or replace,
-- drop trigger if exists / create trigger, grant + revoke.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CLOSE THE guard_profile_role ESCALATION HOLE
--    Old: auth.uid() is null → allow. A code-auth session has null uid
--    AND carries claims, so it must NOT be allowed to change global_role.
--    New: allow the null-uid bypass only when there are NO claims at all
--    (true SQL-editor / service-role bootstrap). A claim-bearing session
--    is never the editor.
-- ---------------------------------------------------------------------
create or replace function app.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The null-uid bootstrap applies ONLY to a session with no app claims —
  -- the Supabase SQL editor or a service_role key. A code-auth session
  -- (team/client) has auth.uid() null BUT carries event_id/app_role
  -- claims; it must never be allowed to change global_role.
  if auth.uid() is null
     and app.jwt_event_id() is null
     and app.jwt_app_role() is null then
    return new;
  end if;

  if new.global_role is distinct from old.global_role and not app.is_admin() then
    raise exception 'Only an admin may change global_role.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function app.guard_profile_role();

-- ---------------------------------------------------------------------
-- 2. STAFF POLICY SET — claim-based, staff-identity-gated writes.
-- ---------------------------------------------------------------------
create or replace function app.apply_staff_policies(p_table text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('alter table public.%I force row level security', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_sel', p_table);
  execute format($f$
    create policy %I on public.%I for select to authenticated
    using (app.is_staff(event_id))
  $f$, p_table || '_sel', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_ins', p_table);
  execute format($f$
    create policy %I on public.%I for insert to authenticated
    with check (
      app.is_staff(event_id)
      and app.has_staff_identity(event_id)
    )
  $f$, p_table || '_ins', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_upd', p_table);
  execute format($f$
    create policy %I on public.%I for update to authenticated
    using (app.is_staff(event_id)) with check (
      app.is_staff(event_id)
      and app.has_staff_identity(event_id)
    )
  $f$, p_table || '_upd', p_table);

  -- Deletes are admin-only, everywhere, always.
  execute format('drop policy if exists %I on public.%I', p_table || '_del', p_table);
  execute format($f$
    create policy %I on public.%I for delete to authenticated
    using (app.is_admin())
  $f$, p_table || '_del', p_table);
end;
$$;

select app.apply_staff_policies(t) from unnest(array[
  'guest_groups', 'guests', 'travel_legs',
  'call_attempts', 'call_recordings', 'transcripts', 'rsvp_extractions',
  'hotels', 'rooms', 'room_assignments',
  'deliverables',
  'vehicles', 'trips', 'trip_passengers',
  'messages', 'import_batches', 'import_rows'
]) as t;

-- call_attempts keeps UPDATE (caller writes ended_at/outcome once) but
-- never DELETE. Re-assert the revoke after the policy rebuild.
revoke delete on public.call_attempts from authenticated;

-- ---------------------------------------------------------------------
-- 3. EVENTS — admin manages; staff/client read only their own event.
-- ---------------------------------------------------------------------
alter table public.events enable row level security;
alter table public.events force row level security;

drop policy if exists events_sel on public.events;
create policy events_sel on public.events for select to authenticated
  using (app.is_member(id));

drop policy if exists events_ins on public.events;
create policy events_ins on public.events for insert to authenticated
  with check (app.is_admin());

drop policy if exists events_upd on public.events;
create policy events_upd on public.events for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists events_del on public.events;
create policy events_del on public.events for delete to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------
-- 4. PROFILES — self or admin. Only admin has a real uid now; a code
--    session has no profiles row and can read none.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.profiles force row level security;

drop policy if exists profiles_sel on public.profiles;
create policy profiles_sel on public.profiles for select to authenticated
  using (id = auth.uid() or app.is_admin());

drop policy if exists profiles_upd_self on public.profiles;
create policy profiles_upd_self on public.profiles for update to authenticated
  using (id = auth.uid() or app.is_admin())
  with check (id = auth.uid() or app.is_admin());

drop policy if exists profiles_ins on public.profiles;
create policy profiles_ins on public.profiles for insert to authenticated
  with check (app.is_admin());

drop policy if exists profiles_del on public.profiles;
create policy profiles_del on public.profiles for delete to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------
-- 5. EVENT_MEMBERS — admin-only writes; read own memberships. Team and
--    client no longer use this table (their access is the claim), so a
--    code session reads zero rows here.
-- ---------------------------------------------------------------------
alter table public.event_members enable row level security;
alter table public.event_members force row level security;

drop policy if exists event_members_sel on public.event_members;
create policy event_members_sel on public.event_members for select to authenticated
  using (user_id = auth.uid() or app.is_admin());

drop policy if exists event_members_ins on public.event_members;
create policy event_members_ins on public.event_members for insert to authenticated
  with check (app.is_admin());

drop policy if exists event_members_upd on public.event_members;
create policy event_members_upd on public.event_members for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists event_members_del on public.event_members;
create policy event_members_del on public.event_members for delete to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------
-- 6. DELIVERY_PROOFS — insert + select only. Insert now records the
--    SELECTED STAFF MEMBER as captured_by_staff (a code session has no
--    uid), gated by has_staff_identity. Legacy rows keep captured_by.
--    The insert-only trigger is untouched.
-- ---------------------------------------------------------------------
alter table public.delivery_proofs enable row level security;
alter table public.delivery_proofs force row level security;

drop policy if exists delivery_proofs_sel on public.delivery_proofs;
create policy delivery_proofs_sel on public.delivery_proofs for select to authenticated
  using (app.is_staff(event_id));

-- A code-auth insert sets captured_by_staff (the selected staff member)
-- and leaves captured_by NULL. An admin insert may set captured_by to
-- their own uid. Either is valid; the shared gate is has_staff_identity.
drop policy if exists delivery_proofs_ins on public.delivery_proofs;
create policy delivery_proofs_ins on public.delivery_proofs for insert to authenticated
  with check (
    app.is_staff(event_id)
    and app.has_staff_identity(event_id)
    and (
      captured_by_staff = app.jwt_staff_member_id()
      or (captured_by_staff is null and captured_by = auth.uid())
    )
  );

revoke update, delete on public.delivery_proofs from authenticated;

-- ---------------------------------------------------------------------
-- 7. NEW CODE-AUTH TABLES — locked down.
-- ---------------------------------------------------------------------

-- EVENT_ACCESS_CODES — admin only, full stop. Team/client never see them.
alter table public.event_access_codes enable row level security;
alter table public.event_access_codes force row level security;

drop policy if exists event_access_codes_sel on public.event_access_codes;
create policy event_access_codes_sel on public.event_access_codes for select to authenticated
  using (app.is_admin());

drop policy if exists event_access_codes_ins on public.event_access_codes;
create policy event_access_codes_ins on public.event_access_codes for insert to authenticated
  with check (app.is_admin());

drop policy if exists event_access_codes_upd on public.event_access_codes;
create policy event_access_codes_upd on public.event_access_codes for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists event_access_codes_del on public.event_access_codes;
create policy event_access_codes_del on public.event_access_codes for delete to authenticated
  using (app.is_admin());

-- STAFF_MEMBERS — admin manages; team reads (for the "Who are you?"
-- picker). Client sees none.
alter table public.staff_members enable row level security;
alter table public.staff_members force row level security;

drop policy if exists staff_members_sel on public.staff_members;
create policy staff_members_sel on public.staff_members for select to authenticated
  using (app.is_admin() or app.is_staff(event_id));

drop policy if exists staff_members_ins on public.staff_members;
create policy staff_members_ins on public.staff_members for insert to authenticated
  with check (app.is_admin());

drop policy if exists staff_members_upd on public.staff_members;
create policy staff_members_upd on public.staff_members for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists staff_members_del on public.staff_members;
create policy staff_members_del on public.staff_members for delete to authenticated
  using (app.is_admin());

-- CODE_REVEAL_LOG — admin read; written by a security-definer function.
alter table public.code_reveal_log enable row level security;
alter table public.code_reveal_log force row level security;

drop policy if exists code_reveal_log_sel on public.code_reveal_log;
create policy code_reveal_log_sel on public.code_reveal_log for select to authenticated
  using (app.is_admin());

revoke insert, update, delete on public.code_reveal_log from authenticated;

-- LOGIN_ATTEMPT_LOG — admin read; written by the Edge Function via a
-- security-definer function (a code-auth session has no uid, so it
-- cannot insert through RLS).
alter table public.login_attempt_log enable row level security;
alter table public.login_attempt_log force row level security;

drop policy if exists login_attempt_log_sel on public.login_attempt_log;
create policy login_attempt_log_sel on public.login_attempt_log for select to authenticated
  using (app.is_admin());

revoke insert, update, delete on public.login_attempt_log from authenticated;

-- ADMIN_DEVICES — admin manages their own + sees all.
alter table public.admin_devices enable row level security;
alter table public.admin_devices force row level security;

drop policy if exists admin_devices_sel on public.admin_devices;
create policy admin_devices_sel on public.admin_devices for select to authenticated
  using (app.is_admin());

drop policy if exists admin_devices_ins on public.admin_devices;
create policy admin_devices_ins on public.admin_devices for insert to authenticated
  with check (app.is_admin());

drop policy if exists admin_devices_upd on public.admin_devices;
create policy admin_devices_upd on public.admin_devices for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

drop policy if exists admin_devices_del on public.admin_devices;
create policy admin_devices_del on public.admin_devices for delete to authenticated
  using (app.is_admin());
