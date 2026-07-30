---
tags: [database, phase-3]
updated: 2026-07-31
---

# Deliverables and Proofs

Back to [[Schema Overview]]. Migration `0300`. Guarantee #2 — and the reason the app beats
a WhatsApp group.

## One table, two kinds

Hampers and return gifts are the same shape. One `deliverables` table with a
`kind` enum (`hamper` | `return_gift`), one `delivery_proofs` table. **Do not build it twice.**

Return gifts are special-guests-only, so rows are simply not created for groups where
`needs_return_gift` is false.

`deliverables` carries `group_id` (required), plus optional `guest_id` and `room_id` — a
hamper can be addressed to a room, a person, or just the family. Status runs
`pending` → `assigned` → `delivered` / `not_required`.

A partial unique index `(group_id, kind) where guest_id is null` keeps group-level
deliverables unique per kind. Per-guest ones are not constrained.

## `delivery_proofs` is immutable

> [!danger] Nobody can alter or delete a proof photo
> Not `event_team`, not `admin`, not the service role.

Four independent locks:

1. No UPDATE policy and no DELETE policy exist on the table
2. `revoke update, delete on public.delivery_proofs from authenticated`
3. `app.block_mutation()` trigger raises `42501` on UPDATE
4. `app.block_mutation()` trigger raises `42501` on DELETE

The triggers are unconditional — they do not check the caller. That is deliberate: an
admin who can quietly delete a proof photo makes the whole record worthless as evidence.

`event_id` and `deliverable_id` are `on delete restrict`, so the parent cannot be deleted
out from under a proof either.

## The server clock wins

`app.force_server_recorded_at()` overwrites `recorded_at` with `now()` on **every** insert.
A phone with a wrong or deliberately fiddled clock cannot backdate a photo. The device's
own claim is kept in `device_captured_at`, clearly marked untrusted.

[[Security Tests|Test 3]] proves this: it inserts a proof claiming `2020-01-01` in both
fields and asserts `recorded_at` is within the last minute.

## Inserting a proof

RLS requires **both**:

```sql
app.is_staff(event_id) and captured_by = auth.uid()
```

So `captured_by` cannot be set to anyone else, even by an admin. See [[Known Traps]].

Storage path must be `delivery-proofs/{event_id}/{deliverable_id}/{uuid}.jpg` — the first
folder segment is the tenant key. See [[Tenancy and RLS]].

## A photo is what marks something delivered

`app.mark_deliverable_delivered()` fires after insert and flips the parent
`deliverables.status` to `delivered`. **Nothing else should.** The status is a consequence
of evidence existing, not a button someone taps.

## There is no "disputed" state

> [!warning] Not implemented
> There is no `disputed` column and no admin dispute flow. If one is wanted, it must be a
> **new sibling table** referencing the proof — do not add a column to `delivery_proofs`,
> because the table cannot be updated. See [[Schema Reality Check]].

## Audit

`delivery_proofs` gets an audit trigger on **insert only** — update and delete are
impossible, so there is nothing else to record.

## Related

[[Rooms and Assignments]] · [[Tenancy and RLS]] · [[Known Traps]] · [[Security Tests]]
