-- =====================================================================
-- 0800 REALTIME PUBLICATION
--
-- Supabase ships an EMPTY `supabase_realtime` publication. Until a table is
-- explicitly added to it, `postgres_changes` delivers nothing: a channel
-- subscribes, reports SUBSCRIBED, and then sits silent forever. Migrations
-- 0100-0700 never touched it, so the calling queue's live sync has been
-- inert since it was written.
--
-- Two tables, not one:
--   guest_groups  - rsvp_status, priority, and the caller lock
--                   (locked_by / locked_until) live here.
--   call_attempts - attempt_count, last_attempt_at, last_outcome and
--                   next_callback_at in v_rsvp_queue are computed ENTIRELY
--                   from this table. Migration 0200 says it plainly:
--                   "Nothing in this chain writes to guest_groups on its
--                   own." Logging an outcome therefore produces no
--                   guest_groups event at all, and without this table in
--                   the publication those four columns go stale on every
--                   other phone on the team.
--
-- This migration only publishes change events. It grants nothing: Realtime
-- applies the same RLS policies as any other read, so a client-role account
-- still receives nothing from either table.
--
-- Idempotent: safe to run against a project where either table is already
-- published, and safe to re-run.
-- =====================================================================

-- The publication normally already exists on a Supabase project; create it
-- only if this is a bare Postgres (e.g. a local `supabase db reset` against
-- an image that has not seeded it).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array['guest_groups', 'call_attempts'] loop
    if not exists (
      select 1
        from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = v_table
    ) then
      execute format(
        'alter publication supabase_realtime add table public.%I', v_table
      );
    end if;
  end loop;
end
$$;

-- REPLICA IDENTITY FULL puts the OLD row into UPDATE and DELETE events.
--
-- Needed for both tables, for two reasons:
--   1. Realtime's row-level authorization and the client-side
--      `filter: event_id=eq.<uuid>` are evaluated against the record in the
--      payload. With the default (REPLICA IDENTITY DEFAULT) a DELETE carries
--      only the primary key, so `event_id` is absent and the event is
--      dropped by the filter rather than delivered.
--   2. Any future consumer that needs to know what a value changed FROM —
--      e.g. "this group was just unlocked" (locked_by went non-null -> null)
--      versus "re-locked by the same caller" — cannot tell without the old
--      row.
--
-- Cost: a wider WAL record per write. On ~238 groups and a few thousand call
-- attempts for one wedding this is not measurable.
alter table public.guest_groups  replica identity full;
alter table public.call_attempts replica identity full;
