---
tags: [database, phase-1]
updated: 2026-07-31
---

# Guests and RSVP

Back to [[Schema Overview]]. Migration `0200`. This is Phase 1.

## The calling unit is the group

You dial one number and the family head answers for six people. So PAX lives on
`guest_groups`, not scattered across individual `guests` rows.

> [!note] The SRS contradicts itself here
> It describes both per-guest and per-group RSVP. **The group wins.** Individual member
> names are collected later, at room allocation — not over the phone.

## `guest_groups`

The calling unit. One row per family head.

| Column | Note |
|---|---|
| `head_name` | required |
| `primary_mobile` / `alt_mobile` | store normalised: 10 digits, no `+91` |
| `expected_pax` | from the sheet, `>= 0`, default 1 |
| `confirmed_pax` | from the call, nullable |
| `rsvp_status` | `not_started` → `attempted` → `callback` / `tentative` / `confirmed` / `declined` / `unreachable` |
| `needs_return_gift` | return gifts are special-guests-only |
| `priority` | higher = call first |
| `locked_by` / `locked_until` | the caller lock |
| `source_row_hash` | idempotent re-import key — see [[Excel Import]] |

Indexes: `(event_id, rsvp_status)`, `(event_id, primary_mobile)`,
`(event_id, priority desc)`, and a partial unique on `(event_id, source_row_hash)`
where the hash is not null.

## The caller lock

With a 10-person calling team, two people **will** dial the same uncle. `claim_group()`
takes a 15-minute lock; `release_group()` drops it. See [[Views and RPCs]].

A lock is re-claimable by its current holder, and expires on its own — a caller whose phone
dies does not block a family forever.

## `guests`

Individual members, linked to a group by composite FK. At most one head per group, enforced
by a partial unique index on `(group_id) where is_head`.

> [!warning] Import must create a head row here
> `client_guest_profiles` is built from `guests`, not `guest_groups`. An import that only
> creates groups leaves the client's screen blank. See [[Known Traps]].

## `travel_legs`

Arrival **and** departure in one table, distinguished by `direction`. This is why
"LHS = RHS" — every group that arrived must leave — is a single query, `v_travel_ledger`.

Holds `mode`, `travel_date`, `travel_time`, `reference` (flight/train/PNR), `point`,
`pax_on_leg`, `needs_transport`, and a `source` enum recording where the fact came from.

## The call chain

```
call_attempts → call_recordings → transcripts → rsvp_extractions
                                                       ↓
                                          apply_rsvp_extraction()
                                                       ↓
                                     guest_groups + travel_legs
```

Nothing in that chain writes to guest data on its own. See [[RSVP Capture Pipeline]].

### `call_attempts` — append-only with one-shot completion

Guarantee #3. Attempt count is `count(*)`, **never a stored counter** — stored counters
drift the moment two devices go offline.

Not strictly insert-only. UPDATE is permitted so a caller can write `ended_at` and
`outcome` when the call finishes. `app.guard_call_attempt()` then:

- force-restores `id`, `event_id`, `group_id`, `caller_id`, `dialed_number`, `started_at`
  to their old values on **every** update
- stamps `finalized_at = now()` the moment `outcome` goes from null to non-null
- raises `42501` on any update once `finalized_at` is set — the row is frozen forever
- raises on every DELETE, and the grant is revoked too

> [!tip] Write the outcome once, at the end
> The row freezes on first outcome. A UI that optimistically sets `outcome` early then
> corrects it will hit a hard error. See [[Known Traps]] for the `tel:` state problem.

`app.force_server_started_at()` moves whatever the phone sent into `device_started_at` and
stamps `started_at` from the server clock. Guarantee #3 of the five.

### `call_recordings`

Storage pointer plus `sha256`, size, mime. `recorded_at` is overwritten with the server
clock; the phone's claim lives in `device_captured_at`, untrusted. `storage_path` is
globally unique.

### `transcripts`

Text plus `language` (`gu-IN` / `hi-IN` / `en-IN`), provider, model, confidence.

> [!note] No audit trigger
> `transcripts` is one of the tables missing audit coverage. See [[Schema Reality Check]].

### `rsvp_extractions`

The AI's structured guess, as `parsed` jsonb plus per-field `confidence` jsonb. Status runs
`pending` → `accepted` / `rejected` / `superseded`.

> [!important] AI output is evidence, not data
> A row here changes **nothing**. Only `apply_rsvp_extraction()`, called after a human
> reviews the screen, writes to `guest_groups` and `travel_legs`.

## Related

[[Views and RPCs]] · [[RSVP Capture Pipeline]] · [[Extraction Contract]] · [[Excel Import]]
