---
tags: [roadmap, planning]
updated: 2026-07-31
---

# Roadmap

Back to [[EventFlow]]. Current position in [[Status]].

## Phase 1 — RSVP

The whole point. Everything else is downstream of knowing who is coming.

| Task | What it is | State |
|---|---|---|
| `p1a` | Schema, RLS, audit triggers | done |
| `p1b` | `test_security.sql` | done |
| `p1c` | [[Excel Import]] from `CALLING_MASTER_LIST.xlsx` | **next** |
| `p1d` | Auth, event switching, role routing | |
| `p1e` | Calling queue — `v_rsvp_queue` + `claim_group()` | |
| `p1f` | Call screen — `tel:` dial + outcome logging | |
| `p1g` | Native call-recording module (Capacitor) | |
| `p1h` | Upload → transcribe → extract | |
| `p1i` | Review screen | |
| `p1j` | Excel export | |

`p1g` is the one task whose *shape* is uncertain — see [[Open Questions]].

## Later phases

| Phase | Scope | Schema |
|---|---|---|
| 2 | Rooms | [[Rooms and Assignments]] — tables exist |
| 3 | Hampers & return gifts | [[Deliverables and Proofs]] — tables exist |
| 4 | Logistics & departure | [[Logistics]] — tables exist |
| 5 | Ship — WhatsApp, admin dashboard, APK, dry run, training | [[Messaging and Import]] |

Every table for phases 2–5 already exists with `event_id` on it. The UI does not. This was
deliberate — see [[Tenancy and RLS]].

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
