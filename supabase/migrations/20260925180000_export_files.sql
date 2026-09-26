-- =====================================================================
-- A11 - THE FILES AREA: EXPORT HISTORY + PRIVATE EXPORT BUCKET
--
-- Every generated export is uploaded to a private bucket and recorded here, so
-- an admin can re-download yesterday's rooming list without re-reading the
-- event. RLS is by event, exactly like every other event-scoped table.
--
-- The bucket is private and its objects policies fence each object by the event
-- id in the FIRST path folder (`<event_id>/<kind>-<stamp>.<ext>`), which
-- `app.is_staff` verifies — the same pattern as the call-recordings and
-- delivery-proofs buckets (20260731000500_rls.sql).
-- =====================================================================

-- 1. The history table ---------------------------------------------------

create table if not exists public.export_files (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  kind       text not null,
  format     text not null,
  path       text not null,
  bytes      bigint not null default 0,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists export_files_event_created_idx
  on public.export_files (event_id, created_at desc);

comment on table public.export_files is
  'One row per generated export; path is the object key in the eventflow-exports bucket.';

alter table public.export_files enable row level security;

drop policy if exists export_files_sel on public.export_files;
create policy export_files_sel on public.export_files
  for select to authenticated using (app.is_staff(event_id));

drop policy if exists export_files_ins on public.export_files;
create policy export_files_ins on public.export_files
  for insert to authenticated with check (app.is_staff(event_id));

drop policy if exists export_files_del on public.export_files;
create policy export_files_del on public.export_files
  for delete to authenticated using (app.is_admin());

grant select, insert, delete on public.export_files to authenticated;

-- 2. The private bucket + its policies -----------------------------------

insert into storage.buckets (id, name, public)
values ('eventflow-exports', 'eventflow-exports', false)
on conflict (id) do nothing;

drop policy if exists "staff read exports" on storage.objects;
create policy "staff read exports"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "staff write exports" on storage.objects;
create policy "staff write exports"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );

-- Regenerating the same kind replaces its object (the adapter upserts), which
-- needs an update policy as well as an insert one.
drop policy if exists "staff update exports" on storage.objects;
create policy "staff update exports"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'eventflow-exports'
    and app.is_staff(((storage.foldername(name))[1])::uuid)
  );
