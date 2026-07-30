---
tags: [brief, context]
updated: 2026-07-31
---

# Project Brief

Back to [[EventFlow]].

## What it replaces

Excel sheets, Google Forms, manual calling records, and manual room / hamper / logistics
tracking — for one large Indian wedding, built so a second wedding can run on the same
database without any code change.

## Scale

| | |
|---|---|
| Family groups | ~238 |
| Individual guests | ~465 |
| Source of truth today | `CALLING_MASTER_LIST.xlsx` |
| Event staff | 10–20, on cheap Android phones |
| Client users | read-only, guest profile cards only |
| Deadline | **26 August 2026** |

## Who writes the code

Prince, driving Claude Code. Assume a competent web developer with **no prior mobile app
experience** — this is why [[Stack Decisions|Capacitor was chosen over Expo]].

## The shape of the work

Phase 1 is the RSVP calling operation, and it is the whole point. 238 families have to be
phoned, their attendance and travel confirmed, and the result turned into something the
logistics team can act on. Everything else — rooms, hampers, vehicles — is downstream of
knowing who is actually coming.

The calling unit is the **group**, not the guest. You dial one number and the family head
answers for six people. This decision propagates everywhere: `expected_pax` and
`confirmed_pax` live on `guest_groups`, calls are logged against a group, and the caller
lock is on a group. See [[Guests and RSVP]].

## Multi-tenancy is not speculative

`event_id` was put on every table up front, deliberately, even where the UI does not exist
yet. Retrofitting tenancy across twenty tables in week three is how deadlines die. See
[[Tenancy and RLS]].

## Related

[[Status]] · [[Roadmap]] · [[Scope Cuts]] · [[Open Questions]]
