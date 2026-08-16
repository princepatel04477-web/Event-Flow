-- =====================================================================
-- EVENT ARCHIVE — a soft delete, because a hard one is impossible.
--
-- IDEMPOTENT: add column if not exists.
--
-- WHY THIS IS NOT A DELETE
-- `delivery_proofs.event_id` is `on delete restrict` (migration
-- 20260731000300, line 163), and the table carries an unconditional
-- `block_mutation()` trigger on both UPDATE and DELETE. So:
--
--   * `delete from events` where any proof exists raises 23503. The
--     cascade never reaches the proofs; RESTRICT stops it first.
--   * You cannot clear the way by deleting the proofs, because the
--     trigger refuses that too — for every role, service role included.
--
-- That is the design working, not a defect to route around: proofs are
-- the audit trail the whole product exists to produce. A delete button
-- would therefore work on a proof-free event and fail with a raw
-- foreign-key error on the one with an operational history behind it —
-- the worst possible split, because it succeeds exactly where the stakes
-- are lowest and explodes where they are highest.
--
-- So archiving is the only operation that behaves identically on every
-- event. Genuinely removing an event stays a deliberate act performed
-- against a proof-free event by a human in the SQL editor, never a
-- button in the UI.
--
-- WHY A TIMESTAMP AND NOT A BOOLEAN
-- `archived_at` answers "when", which `archived = true` cannot. The
-- audit trigger on `events` records the transition, but the column
-- itself staying self-describing means the list can say "archived on
-- 16 Aug" without a join to `audit_log`.
--
-- WHY NOT REUSE is_active
-- `is_active` already exists and is already rendered as an "Inactive"
-- badge on the events list. It means "this event is not currently
-- running" — a state a live event passes through legitimately. Archiving
-- means "hide this from the list". Overloading one column with both
-- would make an event that has merely finished disappear from view.
-- =====================================================================

alter table public.events
  add column if not exists archived_at timestamptz;

comment on column public.events.archived_at is
  'Soft delete. Non-null hides the event from the admin list by default. '
  'There is deliberately no hard-delete path: delivery_proofs.event_id is '
  'ON DELETE RESTRICT and delivery_proofs carries an unconditional '
  'block_mutation() delete trigger, so any event with a proof cannot be '
  'deleted by anyone, service role included.';

-- The list reads `archived_at is null` on every load. Four rows today, but
-- this is the predicate the default view is built on, so it is indexed for
-- when the platform holds a season of weddings.
create index if not exists events_active_idx
  on public.events (created_at desc)
  where archived_at is null;

-- No RLS change. `events_upd` is already
--   using (app.is_admin()) with check (app.is_admin())
-- (migration 20260731000500, line 74), so writing archived_at is
-- admin-only at the database layer. The UI guard is an affordance on top
-- of that fence, never a substitute for it.
