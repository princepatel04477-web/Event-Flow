-- =====================================================================
-- 1904 CODE-AUTH — code generation helpers (used by the create action)
--
-- The event-create server action generates both codes in Node (crypto),
-- inserts the event, then inserts the hashed codes in the same action.
-- These SQL helpers support the admin code-management screens:
-- generate, reveal-log, rotate, revoke.
--
-- IDEMPOTENT: create or replace function.
-- =====================================================================

-- The access-code alphabet (no 0/O/1/I/L — misread over a phone).
-- Shared with the Edge Function and the app's code generator.
create or replace function app.access_code_alphabet()
returns text
language sql
immutable
set search_path = ''
as $$
  select 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
$$;

-- Mark a code rotated: stamp rotated_at on the old row (invalidates
-- sessions issued from it), and let the caller insert the new one.
create or replace function app.rotate_access_code(
  p_code_id uuid,
  p_new_hash text,
  p_new_last_four text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Only an admin may rotate a code.' using errcode = '42501';
  end if;

  update public.event_access_codes
     set rotated_at = now()
   where id = p_code_id
     and rotated_at is null
     and revoked_at is null;

  update public.event_access_codes
     set code_hash = p_new_hash,
         last_four = p_new_last_four,
         rotated_at = null,
         revoked_at = null,
         created_at = now()
   where id = p_code_id;
end;
$$;

-- Revoke a code outright (stops it working; sessions issued from it are
-- invalidated by the Edge Function's revoked_at check).
create or replace function app.revoke_access_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Only an admin may revoke a code.' using errcode = '42501';
  end if;

  update public.event_access_codes
     set revoked_at = now()
   where id = p_code_id
     and revoked_at is null;
end;
$$;

-- Log an admin revealing a code (the audit trail the task requires).
create or replace function app.log_code_reveal(p_code_id uuid, p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_admin() then
    raise exception 'Only an admin may reveal a code.' using errcode = '42501';
  end if;

  insert into public.code_reveal_log (event_id, access_code_id, revealed_by)
  values (p_event_id, p_code_id, auth.uid());
end;
$$;

grant execute on function app.rotate_access_code(uuid, text, text),
  app.revoke_access_code(uuid), app.log_code_reveal(uuid, uuid) to authenticated;
