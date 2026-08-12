-- ---------------------------------------------------------------------
-- Fix public.issue_access_code: the INSERT was missing code_prefix.
--
-- IDEMPOTENT: create or replace function.
--
-- 20260810190000 listed six target columns and supplied five values, so
-- every call failed with 42601 "INSERT has more target columns than
-- expressions". Caught on the first live run. Because the whole function is
-- one transaction, the failure was clean — no code was retired and no half
-- rotation happened, which is exactly why retire+insert+log were put in one
-- function rather than three round trips.
--
-- 20260810190000 has already been recorded as applied, so `db push` will not
-- re-run it; this migration carries the correction to the live database.
-- That file has also been corrected in place, so a fresh replay is right
-- from the start and this one simply replaces it with an identical body.
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

  select id into v_old
    from public.event_access_codes
   where event_id = p_event_id
     and role = p_role
     and rotated_at is null
     and revoked_at is null;

  if v_old is not null then
    -- Retire, do not delete: app.code_is_live() reads the retired row to
    -- recognise and refuse sessions minted from it.
    update public.event_access_codes
       set rotated_at = now()
     where id = v_old;
  end if;

  insert into public.event_access_codes
    (event_id, role, code_hash, code_prefix, last_four, created_by)
  values
    (p_event_id, p_role, p_new_hash, v_prefix, p_new_last_four, auth.uid())
  returning id into v_new;

  insert into public.code_reveal_log (event_id, access_code_id, revealed_by)
  values (p_event_id, v_new, auth.uid());

  return v_new;
end;
$$;

grant execute on function public.issue_access_code(uuid, text, text, text) to authenticated;
