-- =====================================================================
-- Staff department — UI/server gate for field-team navigation.
-- Does NOT change app.event_role or RLS; department lives on
-- staff_members and is copied into the code-auth JWT on pick-staff.
-- Default management so existing rows stay fully navigable.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_type where typname = 'staff_department' and typnamespace = 'app'::regnamespace) then
    create type app.staff_department as enum (
      'management',
      'logistics',
      'hospitality',
      'hamper',
      'production'
    );
  end if;
end $$;

alter table public.staff_members
  add column if not exists department app.staff_department not null default 'management';

comment on column public.staff_members.department is
  'Which screens this person sees after pick-staff. Management sees every '
  'section for the event; department staff see only their tab plus Home. '
  'Enforced in the app layer (JWT claim + nav), not in RLS.';

create index if not exists staff_members_event_department_idx
  on public.staff_members (event_id, department)
  where is_active;
