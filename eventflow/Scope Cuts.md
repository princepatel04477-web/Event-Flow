---
tags: [planning, decisions]
updated: 2026-07-31
---

# Scope Cuts

Back to [[EventFlow]]. Decided in advance so the decision is not made at 2am in August.

## Cut in this order

1. **Departure dashboard** — `v_travel_ledger` still answers "who hasn't got a departure
   leg", just without a screen. Run it as a query.
2. **Excel export (`p1j`)** — painful but survivable. Postgres holds the truth; a CSV can
   be pulled from the SQL editor.
3. **WhatsApp templates beyond three.** Keep: RSVP request, room + arrival confirmation,
   logistics detail. Five are seeded in migration 0700, see [[Messaging and Import]].
4. **Dashboard counters beyond eight.** `v_event_dashboard` computes twelve.
5. **Vehicle *recommendation*.** Greedy PAX fit is a nice-to-have. Vehicle **assignment**
   is a must-have — a guest with no car at the airport is a real failure.

## Never cut

> [!danger] These five stay
> - **Import preview** — [[Excel Import]]. Writing 238 unreviewed rows from a messy sheet
>   is worse than not importing.
> - **Check-in** — the moment a guest physically arrives is the one fact nobody can
>   reconstruct later.
> - **Hamper photo proof** — [[Deliverables and Proofs]]. The entire reason the app beats
>   a WhatsApp group.
> - **Realtime sync** — 10–20 staff on one dataset. Without it they overwrite each other.
> - **The review screen** — [[RSVP Capture Pipeline]]. Cutting it means AI guesses become
>   guest data with nobody looking.

## After feature freeze

The answer to every "can we also add…" is **"after the event."** No exceptions, no
"it's only a small one". See [[Status]] for working rules.
