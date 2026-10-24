-- Seoul -> Mumbai move (2026-10-24). Applied to EventFlow-IN
-- (iqcihrhlopezwkecajan) as version 20261024074910.
--
-- `supabase db dump` skips the storage and auth schemas, so restoring the
-- Seoul dump into Mumbai left storage.objects with ZERO policies (the per-event
-- fence on recordings, proofs and exports) and auth.users without the trigger
-- that creates a profiles row for each new login. These recreate both exactly
-- as they were in Seoul's catalog.
--
-- Written idempotently here: on a fresh `supabase db reset` the same objects
-- already exist from 20260731000100_foundation and 20260731000500_rls (and
-- later migrations), and a plain CREATE would fail the replay. The copy
-- applied to Mumbai was the plain CREATE form; the end state is identical.
--
-- Any future restore from a `db dump` needs the same treatment.

drop policy if exists "staff read call recordings" on storage.objects;
create policy "staff read call recordings" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'call-recordings' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "staff read delivery proofs" on storage.objects;
create policy "staff read delivery proofs" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'delivery-proofs' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "staff read exports" on storage.objects;
create policy "staff read exports" on storage.objects as permissive for select to authenticated
  using (bucket_id = 'eventflow-exports' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "staff update exports" on storage.objects;
create policy "staff update exports" on storage.objects as permissive for update to authenticated
  using (bucket_id = 'eventflow-exports' and app.is_staff(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'eventflow-exports' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "staff upload call recordings" on storage.objects;
create policy "staff upload call recordings" on storage.objects as permissive for insert to authenticated
  with check (bucket_id = 'call-recordings' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "staff upload delivery proofs" on storage.objects;
create policy "staff upload delivery proofs" on storage.objects as permissive for insert to authenticated
  with check (bucket_id = 'delivery-proofs' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop policy if exists "staff write exports" on storage.objects;
create policy "staff write exports" on storage.objects as permissive for insert to authenticated
  with check (bucket_id = 'eventflow-exports' and app.is_staff(((storage.foldername(name))[1])::uuid));

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function app.handle_new_user();
