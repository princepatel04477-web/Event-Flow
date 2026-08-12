-- =====================================================================
-- L1 scratch-database bootstrap — RUN BEFORE THE MIGRATIONS
-- =====================================================================
-- WHY THIS FILE EXISTS
--
-- The migrations never GRANT anything, yet they contain statements like
--   revoke update, delete on public.delivery_proofs from authenticated;
-- Those revokes presuppose that a grant already exists. On a real
-- Supabase project it does: the platform installs ALTER DEFAULT
-- PRIVILEGES so every table created by `postgres`/`supabase_admin`
-- automatically grants ALL to anon, authenticated and service_role,
-- and RLS — not the grant — is what restricts access.
--
-- A hand-built scratch database has none of that. Tables get created
-- with no grants at all, so `authenticated` is refused everywhere at
-- the privilege layer, BEFORE RLS is ever consulted. An adversarial
-- suite run on such a database reports a wall of green for the wrong
-- reason: every attack is "denied" because the role cannot touch any
-- table, not because the policy held.
--
-- Verified: real local `postgres` DB has 190 grants to `authenticated`
-- on schema public; a fresh scratch DB without this file has 5.
--
-- Replicating the platform defaults here is what makes a denial in
-- l1_adversarial.sql mean "RLS or a trigger refused it".
-- =====================================================================

-- Schema visibility, mirroring the real project's namespace ACLs.
create schema if not exists app;
grant usage on schema public to anon, authenticated, service_role;
grant usage on schema app    to anon, authenticated, service_role;

-- The platform default: new tables grant ALL to the API roles, and RLS
-- does the restricting. Applied for BOTH creating roles so it holds
-- regardless of which one the migration runner connects as.
alter default privileges in schema public
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;

alter default privileges in schema app
  grant all on tables    to anon, authenticated, service_role;
alter default privileges in schema app
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema app
  grant execute on functions to anon, authenticated, service_role;
