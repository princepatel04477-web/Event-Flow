---
tags: [ops, risk, open]
updated: 2026-07-31
---

# Open Questions

Back to [[EventFlow]]. Two unresolved items. Only the first can change the *shape* of the
build rather than just its schedule.

## 1. Call recording on Android 13+ — untested

> [!danger] The only structural risk in Phase 1
> Call recording is restricted on many Android 13+ devices. Whether the native Capacitor
> module can capture a live call on **the actual team handsets** is unknown.

**Cost to settle: twenty minutes on one real team phone.** Do this before `p1g`, not during.

Everything else was deliberately built not to depend on the answer:

- `call_recordings` is a storage pointer — it does not care how the audio was produced
- The post-call **voice note** path produces the same row and flows through the same
  transcription and extraction stages
- The [[RSVP Capture Pipeline]] is identical from upload onward either way

So the downside is a worse UX (staff must remember to record a summary after hanging up),
not a redesign. But it changes what `p1g` actually is, so settle it early.

Related: [[Known Traps|no browser can record a live call]] — that part is settled, it is an
OS restriction, not a bug to solve.

## 2. Bus luggage-adjusted capacity — unconfirmed

Sticker sizes are 34 and 56. Seeded as **30 and 50** in migration `0700` — those are
guesses, not vendor numbers.

Every other capacity came from real figures: sedan 3, SUV 4, traveller 17→14, 20→17, 24→20,
33→29. The two bus rows are the odd ones out.

**Confirm with the transport vendor and update `vehicle_types` before the first dispatch.**
Getting it wrong means a bus arrives that cannot fit the group assigned to it.

This is Phase 4 work, so there is time — but it is a phone call, so there is no reason to
carry it.

See [[Logistics]].

## Related

[[Roadmap]] · [[Status]] · [[Known Traps]]
