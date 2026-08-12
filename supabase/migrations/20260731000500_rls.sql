-- =====================================================================
-- 0500 ROW LEVEL SECURITY
--
-- Three roles, exactly as agreed:
--   admin       - you + your friend. Every event. Full power.
--   event_team   - one event only. Read + insert + update operational data.
--                  Cannot delete. Cannot touch events / members / profiles.
--   client       - one event only. NO access to any base table at all.
--                  Reads only the views in 0600. Cannot discover other events.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: apply the standard staff policy set to a table.
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
    with check (app.is_staff(event_id))
  $f$, p_table || '_ins', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_upd', p_table);
  execute format($f$
    create policy %I on public.%I for update to authenticated
    using (app.is_staff(event_id)) with check (app.is_staff(event_id))
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

-- ---------------------------------------------------------------------
-- EVENTS — admin manages; staff/client may read only their own event.
-- This is what stops one event's login from discovering another wedding.
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
-- PROFILES — you see yourself; admin sees everyone.
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

-- Nobody may promote themselves to admin.
create or replace function app.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- auth.uid() is null when the statement comes from the Supabase SQL editor
  -- or a service_role key. That is how you bootstrap the very first admin.
  if auth.uid() is null then
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
-- EVENT_MEMBERS — admin only writes. You may read your own memberships.
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
-- DELIVERY_PROOFS — insert + select only. No update/delete policy exists,
-- so RLS denies them even before the trigger fires. Belt and braces.
-- ---------------------------------------------------------------------
alter table public.delivery_proofs enable row level security;
alter table public.delivery_proofs force row level security;

drop policy if exists delivery_proofs_sel on public.delivery_proofs;
create policy delivery_proofs_sel on public.delivery_proofs for select to authenticated
  using (app.is_staff(event_id));

drop policy if exists delivery_proofs_ins on public.delivery_proofs;
create policy delivery_proofs_ins on public.delivery_proofs for insert to authenticated
  with check (app.is_staff(event_id) and captured_by = auth.uid());

revoke update, delete on public.delivery_proofs from authenticated;

-- call_attempts keeps UPDATE: a caller must be able to write ended_at and
-- outcome once, when the call finishes. app.guard_call_attempt() then freezes
-- the row permanently and blocks every delete.
revoke delete on public.call_attempts from authenticated;

-- ---------------------------------------------------------------------
-- VEHICLE_TYPES + MESSAGE_TEMPLATES — global rows (event_id null) are
-- readable by everyone signed in, writable by admin only.
-- ---------------------------------------------------------------------
alter table public.vehicle_types enable row level security;
alter table public.vehicle_types force row level security;

drop policy if exists vehicle_types_sel on public.vehicle_types;
create policy vehicle_types_sel on public.vehicle_types for select to authenticated
  using (event_id is null or app.is_staff(event_id));

drop policy if exists vehicle_types_ins on public.vehicle_types;
create policy vehicle_types_ins on public.vehicle_types for insert to authenticated
  with check (case when event_id is null then app.is_admin() else app.is_staff(event_id) end);

drop policy if exists vehicle_types_upd on public.vehicle_types;
create policy vehicle_types_upd on public.vehicle_types for update to authenticated
  using (case when event_id is null then app.is_admin() else app.is_staff(event_id) end)
  with check (case when event_id is null then app.is_admin() else app.is_staff(event_id) end);

drop policy if exists vehicle_types_del on public.vehicle_types;
create policy vehicle_types_del on public.vehicle_types for delete to authenticated
  using (app.is_admin());

alter table public.message_templates enable row level security;
alter table public.message_templates force row level security;

drop policy if exists message_templates_sel on public.message_templates;
create policy message_templates_sel on public.message_templates for select to authenticated
  using (event_id is null or app.is_staff(event_id));

drop policy if exists message_templates_ins on public.message_templates;
create policy message_templates_ins on public.message_templates for insert to authenticated
  with check (case when event_id is null then app.is_admin() else app.is_staff(event_id) end);

drop policy if exists message_templates_upd on public.message_templates;
create policy message_templates_upd on public.message_templates for update to authenticated
  using (case when event_id is null then app.is_admin() else app.is_staff(event_id) end)
  with check (case when event_id is null then app.is_admin() else app.is_staff(event_id) end);

drop policy if exists message_templates_del on public.message_templates;
create policy message_templates_del on public.message_templates for delete to authenticated
  using (app.is_admin());

-- ---------------------------------------------------------------------
-- AUDIT LOG — readable by admin only, never writable from the client.
-- ---------------------------------------------------------------------
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;

drop policy if exists audit_log_sel on public.audit_log;
create policy audit_log_sel on public.audit_log for select to authenticated
  using (app.is_admin());

revoke insert, update, delete on public.audit_log from authenticated;

-- ---------------------------------------------------------------------
-- STORAGE
-- Both buckets are PRIVATE. Path convention is  {event_id}/{...}
-- so the first folder segment is the tenant key.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('call-recordings', 'call-recordings', false),
       ('delivery-proofs',  'delivery-proofs',  false)
on conflict (id) do nothing;

drop policy if exists "staff read call recordings" on storage.objects;
create policy "staff read call recordings"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'call-recordings'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff upload call recordings" on storage.objects;
create policy "staff upload call recordings"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'call-recordings'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff read delivery proofs" on storage.objects;
create policy "staff read delivery proofs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'delivery-proofs'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff upload delivery proofs" on storage.objects;
create policy "staff upload delivery proofs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'delivery-proofs'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

-- Deliberately NO update/delete policy on either bucket: an uploaded
-- hamper photo can never be replaced or removed by a staff device.
