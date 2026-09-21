# Feel baseline

**Measured 2026-09-21 at commit `23dacc2`**, against a local `next dev` server seeded to
the real 238-family / 543-guest scale (`SAMPLE2026`, 543 `SEED-543` guests, 782 families).

This is V1's deliverable. It was blocked for three sessions because the **Playwright test
runner** cannot execute in this environment — it hangs before evaluating any spec, and the
repo's own pre-existing `phone` suite hangs identically. The **browser** was never the
problem: a standalone `chromium.launch()` succeeds in ~430 ms and renders. So the harness was
rewritten to drive the browser API directly (`scripts/feel-baseline.mjs`) and the baseline
now exists.

## What was measured, and what was not

| Metric | Status |
|---|---|
| Route load, five routes, two throttle profiles | **MEASURED** |
| **M1** tap → first visual change | **MEASURED** (family row → family record) |
| **M3** tap → real rows on screen | **MEASURED** (same tap; skeletons explicitly excluded) |
| **M2** tap → destination frame | **NOT MEASURED** — separating "the frame painted" from "the first pixel changed" needs a stable frame selector that exists on every route. There is not one, and a proxy would be worse than a stated gap. |
| **M4** commit → screen moved | **NOT MEASURED** — needs the RSVP log flow. |
| **M5** back → list restored | **NOT MEASURED** — needs a list-restore probe. |

**A route load is not a tap.** It is a full document navigation, so it is an upper bound and
must never be compared against a tap budget. It is reported because it is still the number
that decides whether a runner waits before they can do anything at all.

## Throttle profiles

| Profile | Latency | Down | Up |
|---|---|---|---|
| `venue-wifi` | 300 ms | 1.5 Mbps | 0.75 Mbps |
| `4g` | 150 ms | 4 Mbps | 2 Mbps |

Emulated through CDP `Network.emulateNetworkConditions`. Every route was warmed once before
timing, so a cold Turbopack compile is never in a number.

## Route load (full document navigation) — median of 3, ms

| Route | venue-wifi | 4g | venue-wifi worst |
|---|---|---|---|
| home | **4917** | 3531 | 5000 |
| rsvp-queue | 1814 | 2014 | 2112 |
| guest-list | 3299 | 2708 | 3352 |
| **rooms** | **6303** | 5090 | 6313 |
| arrivals | 1323 | 1381 | 1503 |

## Tap (family row → family record) — median of 3, ms

| Profile | M1 first visual change | M3 real rows |
|---|---|---|
| venue-wifi | **3172** | **8301** (worst 30289) |
| 4g | 2258 | 2258 |

## What a runner experiences

**home.** Five seconds on venue Wi-Fi before the board is readable. The runner opens the app
and watches a skeleton for the length of a sentence.

**rsvp-queue.** The best of the five at 1.8s, and still four times over T1's budget before
anything responds.

**guest-list.** 3.3s to a list of 782 families. This is the screen the whole Excel-import
pipeline exists to feed, and it is the second slowest.

**rooms.** **The worst route measured, at 6.3s on venue Wi-Fi and 5.1s even on 4G.** A
runner allocating rooms on a hotel floor waits six seconds every time they come back to the
grid. This is the screen where the wait is felt most, because allocating is a
back-and-forth between a family and a room.

**arrivals.** The fastest at 1.3s — and the one screen that has already been converted to the
shared query cache, which is not a coincidence.

**Tapping a family.** This is the number that matters most and the ugliest one here.
**M1 — the first visual response to a tap — is 3.2s on venue Wi-Fi** against a contract that
says 100 ms. Thirty-two times over. The content took up to **30 seconds** on one run. A
runner taps a name and the phone does nothing for three seconds, so they tap again — which is
the exact behaviour T1 exists to prevent.

## Budgets, now that there are numbers

The `[PROPOSED]` markers in `docs/INTERACTION-CONTRACT.md` have been replaced with these.
Each is achievable but strictly better than what was measured.

| Metric | Budget | Why this number |
|---|---|---|
| tap-to-visual-feedback | **≤ 100 ms** | Not derived from the measurement — it is T1's rule, and the measurement (2258–3172 ms) shows the size of the gap rather than suggesting a softer target. Closing it is what optimistic writes are for, and two screens now do. |
| tap-to-destination-frame | **≤ 300 ms** | Unmeasured, so set from the next best evidence: `arrivals` already loads in 1323 ms, and a cached frame should be a fraction of a full load. 300 ms is the point at which a tap no longer reads as "nothing happened". |
| tap-to-content (cached list) | **≤ 150 ms** | A cached list should paint in about one frame budget plus a fade. This is the assertion that V2 actually works; nothing measured today meets it yet because no route was visited twice within the 30s stale window during the run. |
| tap-to-content (uncached list) | **≤ 2000 ms** | `arrivals` already measures 1323 ms, `rsvp-queue` 1814 ms and `guest-list` 3299 ms, so 2000 ms is met by two of the three and is a real target for the third. It is deliberately NOT set at `rooms`' 6303 ms — that route needs work, not a budget that ratifies it. |
| one action's total server time | **≤ 500 ms** | Unchanged from the proposal. Not measured here; it needs server-side timing, which `traceFetch` already emits and the runner-based spec was to collect. |

## To re-run

```bash
npm run dev                      # needs http://localhost:3000
node scripts/feel-baseline.mjs   # writes a JSON summary and appends a progress log
```

It signs in through the real `/login` → `/pick-staff` flow using `.env.test`, reads the event
code **from where the login landed**, and throttles through CDP.

## Two environment findings that came out of this, worth knowing

1. **`E2E_EVENT_ID` and `E2E_TEAM_CODE` name different events.** `E2E_EVENT_ID` is `E12345`
   ("Nuvent Event"); the team access code signs into `SAMPLE2026`. The acceptance harness
   seeds the former and signs in to the latter. Both happen to hold 543 `SEED-543` guests,
   which is why it has gone unnoticed — but anything that assumes they are the same event is
   measuring a screen the session cannot see. My first harness attempt did exactly that and
   got a page with one link on it. The harness now derives the code from the login landing URL.
2. **`event_access_codes` is empty and `staff_members` has zero rows**, yet the staff picker
   offers "Test Caller A" and login succeeds. Neither table is where that identity comes from,
   and CLAUDE.md §9 describes a staff-roster model that these tables do not currently reflect.
   Not investigated further here; recorded because it contradicts what the docs say.
