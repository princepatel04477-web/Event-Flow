---
tags: [moc, home]
updated: 2026-07-31
---

# EventFlow

Multi-tenant event operations platform for a large Indian wedding. Replaces Excel sheets,
Google Forms, manual calling records, and manual room/hamper/logistics tracking.

> [!info] Deadline
> Submission by **26 August 2026**. See [[Roadmap]] and [[Scope Cuts]].

## Start here

- [[Project Brief]] — what this is, who uses it, scale
- [[Status]] — what is done, what is next
- [[Stack Decisions]] — locked choices, do not re-litigate
- [[Roadmap]] — p1a → p1j, then phases 2–5

## Database

The schema is finished and covers all 19 SRS sections, not just Phase 1.

- [[Schema Overview]] — the table map
- [[Tenancy and RLS]] — how every row is fenced by `event_id`
- [[Roles and Access]] — admin / event_team / client
- [[Views and RPCs]] — the four views, the three functions
- [[Schema Reality Check]] — **read this before trusting any doc**

Per-area detail: [[Guests and RSVP]] · [[Rooms and Assignments]] ·
[[Deliverables and Proofs]] · [[Logistics]] · [[Messaging and Import]]

## Pipelines

- [[Excel Import]] — the next thing to build (`p1c`)
- [[RSVP Capture Pipeline]] — dial → record → transcribe → extract → review → commit
- [[Extraction Contract]] — the JSON shape, and how it maps to the RPC

## Ops

- [[Supabase Project]] — refs, versions, commands
- [[Security Tests]] — what `test_security.sql` actually proves
- [[Known Traps]] — things already learned the hard way
- [[Open Questions]] — two unresolved items

## The five guarantees

Each is enforced in the database, not in application code. Weakening any of them in app
code does nothing — the database will still refuse.

1. Every table is fenced by `event_id` — [[Tenancy and RLS]]
2. Hamper photos cannot be faked or removed — [[Deliverables and Proofs]]
3. Call attempts are append-only — [[Guests and RSVP]]
4. AI output is evidence, not data — [[RSVP Capture Pipeline]]
5. Excel re-import is idempotent — [[Excel Import]]
