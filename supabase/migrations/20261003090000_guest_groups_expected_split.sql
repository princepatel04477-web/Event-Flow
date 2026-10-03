-- =====================================================================
-- F6 — "Differentiate Guest And Adult": split the EXPECTED headcount into
-- adults and children, so the client can see "guests · adults · children"
-- before a family has been called.
--
-- WHY THIS IS A SEPARATE PAIR FROM adults_confirmed / children_confirmed.
-- guest_groups already carries `adults_confirmed` / `children_confirmed`
-- (migration 20260806100000) — the split a caller records on the phone, kept
-- in sync with `confirmed_pax` by app.sync_confirmed_pax(). That covers the
-- CONFIRMED count. The client's ask is the family's guest count in general,
-- which for an uncalled family is the EXPECTED (invited) count. `expected_pax`
-- is a single integer, so this adds its split as a parallel, self-describing
-- pair. Adding bare `adults` / `children` beside `adults_confirmed` /
-- `children_confirmed` would read as two different things called the same
-- name; `expected_*` mirrors the confirmed pair exactly.
--
-- CLIENT ANSWER (3 Oct 2026): a child is anyone aged **under 12**; children
-- count in the headline "guests" number. The counts here are the client's own
-- headcount split, so guests = adults + children wherever the split is set.
--
-- BACKFILL: none, deliberately. Existing families stay NULL until staff (or
-- the Excel import) fill the split in, and the UI says "split not entered for
-- N families" rather than inventing a number.
--
-- IDEMPOTENT: IF NOT EXISTS + DROP CONSTRAINT IF EXISTS, so this is safe to
-- re-run over a live database.
-- =====================================================================

alter table public.guest_groups
  add column if not exists expected_adults    integer check (expected_adults >= 0),
  add column if not exists expected_children  integer check (expected_children >= 0);

comment on column public.guest_groups.expected_adults is
  'Adults in the invited/expected headcount. NULL = the split has not been entered. Split of expected_pax; the confirmed split lives on adults_confirmed.';
comment on column public.guest_groups.expected_children is
  'Children (under 12) in the invited/expected headcount. NULL = the split has not been entered.';

-- When both halves of the expected split are set, they must add up to the
-- family's guest count (expected_pax). One side null means "not entered yet"
-- and is allowed; the write path sets both together.
alter table public.guest_groups
  drop constraint if exists guest_groups_expected_split_matches_pax;

alter table public.guest_groups
  add constraint guest_groups_expected_split_matches_pax
  check (
    expected_adults is null
    or expected_children is null
    or expected_adults + expected_children = expected_pax
  );
