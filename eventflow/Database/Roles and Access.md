---
tags: [database, security]
updated: 2026-07-31
---

# Roles and Access

Back to [[Schema Overview]]. Mechanism in [[Tenancy and RLS]].

Exactly three roles. There is no fourth, and no global "see everything" switch except
`profiles.global_role = 'admin'`.

| | admin | event_team | client |
|---|---|---|---|
| Scope | every event | one event | one event |
| Base tables | read + write + delete | read + insert + update | **nothing** |
| Views | all | staff views | `client_guest_profiles` only |
| Can see other events exist? | yes | no | no |
| Can change roles? | yes | no | no |
| Can delete anything? | yes (except proofs) | no | no |

## Two levels, not one

- `profiles.global_role` — `admin` or `member`. Global.
- `event_members.role` — `event_team` or `client`. Per event, one row per (event, user).

An admin needs no `event_members` row; `app.is_admin()` short-circuits every check. Everyone
else gets access strictly through a membership row.

## The client is view-only, by construction

A client login querying `guest_groups` gets **zero rows** — not an error, not a permission
message. It cannot tell whether the table is empty, whether it lacks permission, or whether
another wedding exists in the same database.

The only thing it can read is `client_guest_profiles`. That view is
`security_invoker = false`, so it runs as owner and bypasses base-table RLS entirely; its
`where app.is_member(g.event_id)` clause is the only fence. See [[Views and RPCs]].

> [!warning] Treat that view as a security boundary
> Any edit to `client_guest_profiles` is a security change, not a UI change. Adding a
> column exposes it to the wedding family. It deliberately omits mobile numbers, expenses,
> call history, and everything about any other event.

## Deletes

Admin only, everywhere, always — the `_del` policy is `using (app.is_admin())` on every
staff-policy table. `event_team` deleting a row gets **0 rows affected**, not an error, so
UI must not assume success means deletion.

Two exceptions where nobody at all can delete:

- `delivery_proofs` — [[Deliverables and Proofs]]
- `call_attempts` — [[Guests and RSVP]]

## Field-staff sub-roles do not exist

Sub-roles like `desk` or `hamper` are **not in the schema**. `app.event_role` is exactly
`('event_team', 'client')`. Adding one means an enum value plus revisiting every
`app.is_staff()` call site. See [[Schema Reality Check]].

## Related

[[Tenancy and RLS]] · [[Views and RPCs]] · [[Security Tests]]
