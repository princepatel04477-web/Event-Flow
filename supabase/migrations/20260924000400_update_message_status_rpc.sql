-- =====================================================================
-- M36: Secure message status update RPC for webhook
--
-- Incoming BSP webhooks cannot authenticate as Supabase users.
-- This security definer function allows updating message delivery/read
-- status by provider_message_id without bypassing other message table RLS.
-- =====================================================================

create or replace function public.update_message_status(
  p_provider_message_id text,
  p_status text,
  p_sent_at timestamptz default null,
  p_delivered_at timestamptz default null,
  p_read_at timestamptz default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer;
begin
  if p_provider_message_id is null or p_provider_message_id = '' then
    return false;
  end if;

  update public.messages
     set status = p_status::public.app.message_status,
         sent_at = coalesce(p_sent_at, sent_at),
         delivered_at = coalesce(p_delivered_at, delivered_at),
         read_at = coalesce(p_read_at, read_at),
         error = coalesce(p_error, error)
   where provider_message_id = p_provider_message_id;

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

grant execute on function public.update_message_status(text, text, timestamptz, timestamptz, timestamptz, text)
  to anon, authenticated;
