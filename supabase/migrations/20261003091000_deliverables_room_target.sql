-- =====================================================================
-- F8a — hampers room-wise: the delivery target becomes polymorphic.
--
-- CLIENT ANSWER (3 Oct 2026): one hamper per room; when a family is split
-- across rooms, each room gets its own hamper.
--
-- BEFORE: a hamper targeted a FAMILY (`group_id not null`) and merely carried
-- the family's latest `room_id`; `deliverables_one_per_group_kind` made it one
-- hamper per family. AFTER: a hamper targets exactly one of room / family /
-- guest, and the room is the normal target.
--
-- EVENT SCOPING. The existing composite FKs `(room_id, event_id)`,
-- `(group_id, event_id)`, `(guest_id, event_id)` referencing `unique (id,
-- event_id)` on each parent are what fence a target to the same event — a
-- CONSTRAINT, not a trigger, so PostgREST and the service role are covered
-- too. No new trigger is added for this; the composite FKs already do it.
--
-- QUANTITY. `deliverables.quantity` is already
-- `integer not null default 1 check (quantity > 0)`. It is STORED at
-- assignment, never computed on read, so a later room move cannot change a
-- hamper that was already delivered. The client's rule (one per room) sets it
-- to 1 at assignment time; the screen (F8b) owns the rule.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE throughout.
--
-- ⚠ APPLY ORDER: this migration alone makes the OLD code path
--   `generateDeliverables()` (src/lib/actions/deliveries.ts) fail, because it
--   inserts `group_id + room_id` together, which the new exactly-one CHECK
--   rejects. F8b must update that action (and the hamper screen) IN THE SAME
--   RELEASE. Do not apply this into a live event without F8b.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Polymorphic target: exactly one of room_id / group_id / guest_id.
-- ---------------------------------------------------------------------
alter table public.deliverables alter column group_id drop not null;

-- Existing family hampers also carried a room. Their TARGET is the family, so
-- keep group_id and clear the incidental room link (F8a: "existing rows keep
-- their current target"), which is what lets the CHECK below hold.
update public.deliverables
   set room_id = null
 where group_id is not null
   and room_id is not null;

alter table public.deliverables drop constraint if exists deliverables_one_target;
alter table public.deliverables
  add constraint deliverables_one_target
  check (num_nonnulls(room_id, group_id, guest_id) = 1);

-- ---------------------------------------------------------------------
-- 2) Uniqueness is per TARGET kind, not per family.
-- ---------------------------------------------------------------------
drop index if exists public.deliverables_one_per_group_kind;
create unique index if not exists deliverables_one_per_group_kind
  on public.deliverables (group_id, kind)
  where group_id is not null and guest_id is null;

-- One hamper per ROOM. This is the client's rule, enforced in the database so
-- two phones assigning at once cannot create two.
create unique index if not exists deliverables_one_per_room_kind
  on public.deliverables (room_id, kind)
  where room_id is not null;

create unique index if not exists deliverables_one_per_guest_kind
  on public.deliverables (guest_id, kind)
  where guest_id is not null;

-- ---------------------------------------------------------------------
-- 3) The auto-hamper now targets the ROOM.
-- ---------------------------------------------------------------------
create or replace function app.ensure_hamper_for_assignment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.released_at is not null or new.room_id is null then
    return new;
  end if;

  insert into public.deliverables (event_id, room_id, kind, quantity, item_name)
  values (new.event_id, new.room_id, 'hamper', 1, 'Welcome hamper')
  on conflict (room_id, kind) where room_id is not null do nothing;

  return new;
end;
$function$;

-- Backfill: one hamper per room that has an active assignment today.
insert into public.deliverables (event_id, room_id, kind, quantity, item_name)
select distinct ra.event_id, ra.room_id, 'hamper'::app.deliverable_kind, 1, 'Welcome hamper'
  from public.room_assignments ra
 where ra.released_at is null
   and ra.room_id is not null
on conflict (room_id, kind) where room_id is not null do nothing;

-- ---------------------------------------------------------------------
-- 4) Proofs snapshot the room at seal time. Proofs stay INSERT-ONLY: this adds
--    a column and a BEFORE INSERT trigger only — no update, no delete, and
--    existing proofs are not touched.
-- ---------------------------------------------------------------------
alter table public.delivery_proofs add column if not exists room_id uuid;

create or replace function app.snapshot_proof_room()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.room_id is null then
    select d.room_id into new.room_id
      from public.deliverables d
     where d.id = new.deliverable_id;
  end if;
  return new;
end;
$$;

drop trigger if exists delivery_proofs_snapshot_room on public.delivery_proofs;
create trigger delivery_proofs_snapshot_room
  before insert on public.delivery_proofs
  for each row execute function app.snapshot_proof_room();

comment on column public.delivery_proofs.room_id is
  'Snapshot of the hamper''s room at seal time. Insert-only; existing proofs are left NULL and must not be backfilled.';

-- ---------------------------------------------------------------------
-- 5) RLS — additive only. A client may read ROOM-targeted hampers for their
--    own event (the read-only room-wise hamper status, F8b). Family/guest
--    hampers stay staff-only, and `delivery_proofs` (and every storage path)
--    stays `app.is_staff` — the client never gains a proof photo.
-- ---------------------------------------------------------------------
drop policy if exists deliverables_client_room_sel on public.deliverables;
create policy deliverables_client_room_sel on public.deliverables
  for select to authenticated
  using (app.is_member(event_id) and room_id is not null);
