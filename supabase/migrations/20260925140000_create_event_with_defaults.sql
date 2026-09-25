-- =====================================================================
-- A7 - CREATE EVENT IN ONE ROUND TRIP
--
-- Creating an event used to be two sequential PostgREST inserts (events,
-- then the two event_access_codes) after two dynamic module imports and a
-- pair of hash computations — each insert a full ~150ms hop from India to the
-- Supabase region. This folds both inserts into one transaction so the create
-- costs one hop, not two.
--
-- The codes are still generated and hashed in the app (`lib/auth/codes`), so
-- their plaintext never reaches the database; the RPC receives only hashes.
--
-- SECURITY INVOKER, deliberately: `events` is `insert with check
-- (app.is_admin())` and `event_access_codes` is likewise admin-gated, so
-- running as the caller means those policies are the fence. A DEFINER function
-- here would hand any authenticated user a way to mint events and codes.
--
-- The `auth.uid() is null` guard turns a code-auth session trying to create an
-- event into a named 42501 rather than a bare not-null violation deeper down.
-- =====================================================================

create or replace function public.create_event_with_defaults(
  p_name            text,
  p_code            text,
  p_bride_name      text,
  p_groom_name      text,
  p_starts_on       date,
  p_ends_on         date,
  p_team_hash       text,
  p_team_last_four  text,
  p_client_hash     text,
  p_client_last_four text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id   uuid;
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'Sign in again to create an event.' using errcode = '42501';
  end if;

  if p_name is null or btrim(p_name) = '' then
    raise exception 'Give the event a name.' using errcode = '22023';
  end if;
  if p_code is null or btrim(p_code) = '' then
    raise exception 'Give the event a short code.' using errcode = '22023';
  end if;
  if p_starts_on is null then
    raise exception 'Pick the first day of the event.' using errcode = '22023';
  end if;

  insert into public.events (
    name, code, bride_name, groom_name, starts_on, ends_on, created_by
  )
  values (
    btrim(p_name),
    btrim(p_code),
    nullif(btrim(coalesce(p_bride_name, '')), ''),
    nullif(btrim(coalesce(p_groom_name, '')), ''),
    p_starts_on,
    p_ends_on,
    auth.uid()
  )
  returning id, code into v_id, v_code;

  insert into public.event_access_codes (
    event_id, role, code_hash, code_prefix, last_four, created_by
  )
  values
    (v_id, 'team',   p_team_hash,   'E', p_team_last_four,   auth.uid()),
    (v_id, 'client', p_client_hash, 'C', p_client_last_four, auth.uid());

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

revoke all on function public.create_event_with_defaults(
  text, text, text, text, date, date, text, text, text, text
) from public;

grant execute on function public.create_event_with_defaults(
  text, text, text, text, date, date, text, text, text, text
) to authenticated;
