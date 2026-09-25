-- =====================================================================
-- A8 - PER-EVENT SECTION LOCKS
--
-- An admin can lock a section for an event (rsvp, hospitality, hamper,
-- logistics). Locked means READ-ONLY FOR STAFF, and it is enforced in the
-- DATABASE, not just hidden in the UI: a staff write to a locked section is
-- refused by a BEFORE trigger, so it fails even through PostgREST or a raw
-- session.
--
-- WHY A TRIGGER AND NOT ONLY RLS. The tables in these sections (guest_groups,
-- rooms, deliverables, travel_legs, ...) already carry the shared staff
-- policies from `app.apply_staff_policies`. Rewriting four policies per table
-- to ALSO test a lock would touch ~11 tables' policy sets and risk opening a
-- hole on one of them. A single BEFORE row trigger per table is additive: it
-- can only ever REFUSE a write, never widen one, and it covers INSERT, UPDATE
-- and DELETE uniformly.
--
-- ADMINS BYPASS THE LOCK. `app.is_admin()` is checked first, so the admin who
-- set the lock keeps working; a lock is a fence around the field team, not the
-- office.
--
-- The lock table itself is admin-write / staff-read (staff must read it to show
-- the "Locked by admin" banner), enforced by RLS.
-- =====================================================================

-- 1. The lock table ------------------------------------------------------

create table if not exists public.event_section_locks (
  event_id  uuid not null references public.events (id) on delete cascade,
  section   text not null check (section in ('rsvp', 'hospitality', 'hamper', 'logistics')),
  locked_by uuid,
  locked_at timestamptz not null default now(),
  primary key (event_id, section)
);

comment on table public.event_section_locks is
  'Per-event, per-section write locks. Presence of a row = locked for staff; admins bypass. Enforced by app.enforce_section_lock() triggers.';

alter table public.event_section_locks enable row level security;

drop policy if exists event_section_locks_sel on public.event_section_locks;
create policy event_section_locks_sel on public.event_section_locks
  for select to authenticated using (app.is_staff(event_id));

drop policy if exists event_section_locks_ins on public.event_section_locks;
create policy event_section_locks_ins on public.event_section_locks
  for insert to authenticated with check (app.is_admin());

drop policy if exists event_section_locks_upd on public.event_section_locks;
create policy event_section_locks_upd on public.event_section_locks
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists event_section_locks_del on public.event_section_locks;
create policy event_section_locks_del on public.event_section_locks
  for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.event_section_locks to authenticated;

-- 2. The enforcement trigger function ------------------------------------

create or replace function app.enforce_section_lock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section  text := tg_argv[0];
  v_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  -- The office keeps working while the field team is fenced out.
  if app.is_admin() then
    return coalesce(new, old);
  end if;

  if v_event_id is null then
    return coalesce(new, old);
  end if;

  if exists (
    select 1 from public.event_section_locks l
     where l.event_id = v_event_id
       and l.section = v_section
  ) then
    raise exception 'The % section is locked by an admin.', v_section
      using errcode = '42501';
  end if;

  return coalesce(new, old);
end;
$$;

-- 3. Attach it to every table that belongs to a lockable section ---------
--
-- Each entry is (table, section). All of these carry `event_id`, which is what
-- the trigger reads. `drop trigger if exists` first makes the migration
-- replay-safe.

do $$
declare
  v record;
begin
  for v in
    select * from (values
      ('guest_groups',      'rsvp'),
      ('guests',            'rsvp'),
      ('call_attempts',     'rsvp'),
      ('hotels',            'hospitality'),
      ('rooms',             'hospitality'),
      ('room_assignments',  'hospitality'),
      ('deliverables',      'hamper'),
      ('delivery_proofs',   'hamper'),
      ('travel_legs',       'logistics'),
      ('trips',             'logistics'),
      ('trip_passengers',   'logistics')
    ) as t(tbl, sect)
  loop
    execute format('drop trigger if exists %I on public.%I', v.tbl || '_section_lock', v.tbl);
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each row execute function app.enforce_section_lock(%L)',
      v.tbl || '_section_lock', v.tbl, v.sect
    );
  end loop;
end $$;
