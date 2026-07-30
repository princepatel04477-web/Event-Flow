---
tags: [database, api]
updated: 2026-07-31
---

# Views and RPCs

Back to [[Schema Overview]]. Migration `0600`.

## `client_guest_profiles` — the client's entire world

> [!danger] Security boundary, not a UI component
> `security_invoker = false`. The view runs as **owner and bypasses base-table RLS**. Its
> `where app.is_member(g.event_id)` clause is the only thing fencing it. Adding a column
> exposes that column to the wedding family. Treat every edit as a security change.

Built from `guests` (not `guest_groups` — see [[Known Traps]]). Per guest it returns:
name, family head, group type, side, pax, hotel + room number, first arrival leg, first
departure leg, and hamper / return-gift delivery booleans.

Deliberately absent: mobile numbers, expenses, call history, anything about another event.

Arrival and departure come from `left join lateral … order by travel_date, travel_time
limit 1` — so a group with two arrival legs shows only the earliest.

## `v_rsvp_queue` — the calling queue (`p1e`)

`security_invoker = true`, so normal staff RLS applies and a client sees nothing.

Per group: identity, pax, `rsvp_status`, `priority`, `remarks`, the lock fields, plus a
computed `is_locked` (`locked_until > now()`), and from a lateral over `call_attempts`:
`attempt_count` (a live `count(*)`), `last_attempt_at`, `last_outcome`, `next_callback_at`.

This is the one view `p1e` is built on. Sort by `priority desc`, filter `is_locked = false`.

## `v_travel_ledger` — LHS = RHS

Per group, counts arrival legs and departure legs and classifies:

| `ledger_state` | meaning |
|---|---|
| `no_arrival` | never told us how they're coming |
| `departure_missing` | arrived, no way out booked |
| `balanced` | both sides present |

The departure dashboard is [[Scope Cuts|first on the cut list]] — this view answers the
question as a query regardless.

## `v_event_dashboard`

Twelve counters per event: total groups, total pax, rsvp confirmed / pending, arrivals and
departures today, guests roomed, hampers delivered / pending, return gifts delivered,
logistics expense. Phase 5 keeps eight of them.

## `claim_group(p_group_id uuid, p_minutes integer default 15)`

Takes the caller lock. Succeeds if the group is unlocked, the lock has expired, **or the
caller already holds it** (re-entrant, so a page refresh doesn't lock you out of your own
call). Otherwise raises `55P03 lock_not_available`.

Returns the whole `guest_groups` row.

## `release_group(p_group_id uuid)`

Clears the lock. Only the holder or an admin can. Silent no-op otherwise — check the row
afterwards rather than trusting success.

## `apply_rsvp_extraction(p_extraction_id uuid, p_payload jsonb)`

> [!important] The only path from AI output into guest data
> One transaction: a review lands completely or not at all.

Sequence: load the extraction → require `app.is_staff(event_id)` → refuse if already
`accepted` → update `guest_groups` → upsert arrival and departure legs → mark the
extraction `accepted` with `reviewed_by` / `reviewed_at` / `applied_at`, storing the payload
the human actually approved. Also **clears the caller lock**.

Exact key mapping is in [[Extraction Contract]] — the payload shape is *not* the same as
the shape the model emits.

Three behaviours worth knowing:

- **Every field uses `coalesce(new, existing)`.** Omitting a key leaves the current value
  alone. There is **no way to null a field out** through this RPC.
- **Only the oldest leg per direction is updated** — `order by created_at limit 1`. A group
  with two arrival legs will never see the second updated here.
- **Only `accepted` blocks re-application.** A `rejected` or `superseded` extraction can
  still be applied.

All three are granted to `authenticated` and are `security definer` with
`set search_path = ''`.

## Related

[[Guests and RSVP]] · [[Roles and Access]] · [[RSVP Capture Pipeline]] · [[Schema Reality Check]]
