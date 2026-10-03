-- =====================================================================
-- public.pipeline_secret(name): Edge Functions read their secrets from Vault
--
-- transcribe-recording (and later extract-rsvp) need SARVAM_API_KEY and a
-- webhook secret. Setting Edge Function secrets needs the Supabase CLI on a
-- logged-in machine; Vault needs only the SQL Editor. The functions now try
-- the Edge Function secret first and fall back to this function.
--
-- SECURITY (do not weaken):
--   * security definer, empty search_path.
--   * EXECUTE is revoked from public, anon and authenticated, and granted to
--     service_role ONLY. A staff or client session calling this through
--     PostgREST gets "permission denied". The service role could already read
--     vault.decrypted_secrets directly, so this grants it nothing new.
--   * Allow-list of names. Anything else returns null, so this can never be
--     used to read an unrelated Vault secret.
--   * No secret VALUES are in this file. They are created with
--     vault.create_secret in the SQL Editor (see docs/CALL-5-TEST.md).
-- =====================================================================

create or replace function public.pipeline_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select ds.decrypted_secret
    from vault.decrypted_secrets ds
   where ds.name = p_name
     and p_name in (
       'sarvam_api_key',
       'transcribe_webhook_secret',
       'anthropic_api_key',
       'extract_webhook_secret'
     )
   limit 1
$$;

revoke all on function public.pipeline_secret(text) from public;
revoke all on function public.pipeline_secret(text) from anon;
revoke all on function public.pipeline_secret(text) from authenticated;
grant execute on function public.pipeline_secret(text) to service_role;

comment on function public.pipeline_secret(text) is
  'Service-role-only read of allow-listed pipeline secrets from Vault, for Edge '
  'Functions that have no Edge Function secret set.';
