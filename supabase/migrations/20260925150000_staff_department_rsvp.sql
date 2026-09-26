-- =====================================================================
-- A8 - THE RSVP / CALLS DEPARTMENT
--
-- Adds a sixth value to `app.staff_department` so a calling team can be given
-- its own role: sections dashboard + rsvp, landing on the call queue.
--
-- `add value if not exists` is idempotent and safe here: PostgreSQL 12+ allows
-- ALTER TYPE ... ADD VALUE inside a transaction as long as the new value is not
-- USED in the same transaction, and this migration only declares it. The
-- app-layer union (src/lib/departments.ts) is updated in the same commit.
-- =====================================================================

alter type app.staff_department add value if not exists 'rsvp';

comment on type app.staff_department is
  'Field-team department. rsvp = "RSVP / Calls": dashboard + rsvp sections, home = the call queue.';
