-- ---------------------------------------------------------------------
-- public.issue_access_code — the missing issuance path.
--
-- IDEMPOTENT: create or replace function.
--
-- WHY THIS EXISTS
-- `event_access_codes` stores sha256 only, with no plaintext column and no
-- decrypt path. That is correct — a stolen dump must not hand over every
-- staff login — but it means the plaintext lives for exactly one moment, at
-- generation. On 2026-08-07 an event's codes were shown once at creation and
-- never again; one event was recoverable only because a copy survived in
-- .env.test, and another (SHARMA26) had no code rows at all. The fix is not
-- to store plaintext. It is to make re-issuing trivial.
--
-- WHY A public. WRAPPER
-- `app.rotate_access_code` and `app.log_code_reveal` are in the `app` schema,
-- which PostgREST does not expose (config.toml lists public + graphql_public).
-- They are unreachable from supabase.rpc(). Same reasoning as
-- public.session_code_live().
--
-- WHY ONE FUNCTION AND NOT THREE CALLS
-- Retire-old / insert-new / log-reveal must not half-happen. Doing it in the
-- app meant three round trips over a link that TEST-LOG records as dropping
-- roughly one connection in three: a failure between them could retire the
-- live code and never create its replacement, locking every staff member out
-- of the event with no code to hand them. One function, one transaction.
-- ---------------------------------------------------------------------

create or replace function public.issue_access_code(
  p_event_id       uuid,
  p_role           text,
  p_new_hash       text,
  p_new_last_four  text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    uuid;
  v_prefix text;
  v_new    uuid;
begin
  if not app.is_admin() then
    raise exception 'Only an admin may issue an access code.' using errcode = '42501';
  end if;

  if p_role not in ('team', 'client') then
    raise exception 'Unknown role %', p_role using errcode = '22023';
  end if;

  v_prefix := case when p_role = 'team' then 'E' else 'C' end;

  -- At most one live row per (event, role) — enforced by
  -- event_access_codes_one_live_per_role.
  select id into v_old
    from public.event_access_codes
   where event_id = p_event_id
     and role = p_role
     and rotated_at is null
     and revoked_at is null;

  if v_old is not null then
    -- Retire, do not delete. The retired row is what app.code_is_live()
    -- reads to recognise and refuse sessions minted from it — deleting it
    -- would leave those sessions unrecognised and therefore working.
    update public.event_access_codes
       set rotated_at = now()
     where id = v_old;
  end if;

  insert into public.event_access_codes
    (event_id, role, code_hash, code_prefix, last_four, created_by)
  values
    (p_event_id, p_role, p_new_hash, v_prefix, p_new_last_four, auth.uid())
  returning id into v_new;

  -- Same transaction: an issued code that is not logged is an unanswerable
  -- "who gave this out".
  insert into public.code_reveal_log (event_id, access_code_id, revealed_by)
  values (p_event_id, v_new, auth.uid());

  return v_new;
end;
$$;

grant execute on function public.issue_access_code(uuid, text, text, text) to authenticated;

comment on function public.issue_access_code(uuid, text, text, text) is
  'Issue a fresh access code for one event and role: retires the live row '
  '(kept, so code_is_live() still recognises its sessions), inserts the '
  'replacement, and writes code_reveal_log — all in one transaction. The '
  'caller generates the plaintext and passes only its sha256; the plaintext '
  'is never sent to or stored by the database.';
