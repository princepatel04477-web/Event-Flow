-- =====================================================================
-- A9 - ARRIVAL NOTIFICATION SETTING
--
-- One admin on/off switch per event for arrival notifications (the in-app
-- banner and, when configured, push). Defaults to ON, so an existing event
-- starts notifying without anyone having to find the switch.
--
-- Staff read it (to decide whether to render the banner); only an admin writes
-- it. Enforced by RLS like every other per-event setting.
-- =====================================================================

create table if not exists public.event_notification_settings (
  event_id         uuid primary key references public.events (id) on delete cascade,
  arrivals_enabled boolean not null default true,
  updated_at       timestamptz not null default now()
);

comment on table public.event_notification_settings is
  'Per-event notification switches. arrivals_enabled gates the arrival banner and push (A9).';

alter table public.event_notification_settings enable row level security;

drop policy if exists event_notification_settings_sel on public.event_notification_settings;
create policy event_notification_settings_sel on public.event_notification_settings
  for select to authenticated using (app.is_staff(event_id));

drop policy if exists event_notification_settings_ins on public.event_notification_settings;
create policy event_notification_settings_ins on public.event_notification_settings
  for insert to authenticated with check (app.is_admin());

drop policy if exists event_notification_settings_upd on public.event_notification_settings;
create policy event_notification_settings_upd on public.event_notification_settings
  for update to authenticated using (app.is_admin()) with check (app.is_admin());

drop policy if exists event_notification_settings_del on public.event_notification_settings;
create policy event_notification_settings_del on public.event_notification_settings
  for delete to authenticated using (app.is_admin());

grant select, insert, update, delete on public.event_notification_settings to authenticated;
