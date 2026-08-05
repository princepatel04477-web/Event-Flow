---
tags: [roadmap, planning]
updated: 2026-08-02
---

# Roadmap

Back to [[EventFlow]]. Current position in [[Status]].

## Phase 1 — RSVP

The whole point. Everything else is downstream of knowing who is coming.

| Task | What it is | State |
|---|---|---|
| `p1a` | Schema, RLS, audit triggers | ✅ done |
| `p1b` | `test_security.sql` | ✅ done |
| `p1c` | [[Excel Import]] — parse + preview | ✅ done (preview only — commit RPC pending) |
| `p1d` | Auth, event switching, role routing + client profile cards | ✅ done |
| `p1e` | Calling queue — `v_rsvp_queue` + `claim_group()` + realtime | ✅ done |
| `p1f` | Call screen — `tel:` dial + outcome logging + offline outbox | ✅ done |
| `p1g` | Native call-recording module (Capacitor) | ❌ not started |
| `p1h` | Extraction model + payload translation | ✅ done (review screen built alongside) |
| `p1i` | Review screen | ✅ done |
| `p1j` | Excel export | ❌ not started |

`p1g` is the one task whose *shape* is uncertain — see [[Open Questions]].

**The import commit (database write) is the single largest remaining Phase 1 item:**
`app.commit_guest_import()` — one Postgres function, one transaction. The parse
pipeline, preview UI, mobile normalisation, and idempotent matching are all done.

## Phase 2 — Rooms (current)

| Scope | Schema |
|---|---|
| [[Rooms and Assignments]] — allocation backend, hotel/room management UI | Tables exist. `GuestCard` renders hotel/room but shows "not allocated yet". Import parser captures room/bed columns as `OPTIONAL_COLUMNS`. |

The client profile cards at `/[eventCode]/guests` are built and working. What
remains: writing room assignments to the database (the allocation backend) and
building the staff-facing room management UI.

## Phase 3

| Scope | Schema |
|---|---|
| Hampers & return gifts | [[Deliverables and Proofs]] — tables exist |

## Phase 4

| Scope | Schema |
|---|---|
| Logistics & departure | [[Logistics]] — tables exist |

## Phase 5

| Scope | Schema |
|---|---|
| Ship — WhatsApp, admin dashboard, APK, dry run, training | [[Messaging and Import]] |

Every table for phases 2–5 already exists with `event_id` on it. The UI does not.
This was deliberate — see [[Tenancy and RLS]].

## Scope cuts, in order, if time runs short

1. Departure dashboard
2. Excel export (`p1j`)
3. WhatsApp templates beyond three — RSVP request, room + arrival confirmation, logistics detail
4. Dashboard counters beyond eight
5. Vehicle *recommendation* — vehicle *assignment* is a must-have

> [!danger] Never cut
> Import preview · check-in · hamper photo proof · realtime sync · **the review screen**

The review screen is non-negotiable because without it the system writes AI guesses
straight into guest data. See [[RSVP Capture Pipeline]].
