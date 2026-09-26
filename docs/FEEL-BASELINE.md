# Feel baseline

Two measurements live in this file. **The newest is at the top**; the V1 `next dev` baseline it
replaced is kept below, unchanged, so the before/after is readable in one place.

---

## 2026-09-26 — S0: re-measured against a **production build** (`next start`)

**Measured 2026-09-26 on `brain/showcase`**, against `NEXT_PUBLIC_UI=v2 npm run build` served
by `npm run start` on `http://localhost:3000`, signed in through `/login` → `/pick-staff` as the
team caller and measuring event **`SAMPLE2026`** (the code read from the login landing URL, not
`E2E_EVENT_ID`).

Why re-measure: the 2026-09-21 numbers below were taken on `next dev`, which is slower and
noisier than what staff get (Turbopack compiles per request, React runs in dev mode). Every
later prompt in the feel series has to be judged against a production build, so this section is
the number those prompts beat. **The old section is not deleted** — it documents V1 and is the
proof that the app was slow on the thing the phone actually runs.

### What is measured now, and what still is not

| Metric | Status |
|---|---|
| Route load, five routes, two throttle profiles | **MEASURED** on `next start` |
| **M1** tap → first visual change | **MEASURED** (family row → family record) |
| **M2** tap → destination frame | **NOW MEASURED.** Every v2 screen carries `data-screen="<route-id>"` on the root of its main column (added in this commit: `home`, `guests`, `calls`, `rooms`, `arrivals`, `family`). The probe waits for `[data-screen="family"]` — the destination's own value, not a bare `[data-screen]`, because the list being left already carries one. |
| **M3** tap → real rows on screen | **MEASURED** (same tap; skeletons explicitly excluded) |
| **M5** back → list restored | **NOW MEASURED.** From the record, `history.back()`, then the SAME row that was tapped must be visible again. |
| **M4** commit → screen moved | **NOT MEASURED** — needs the RSVP log flow. `scripts/tap-budget.mjs` owns it. |

### Route load (full document navigation) — median of 3, ms

| Route | venue-wifi | 4g | venue-wifi worst |
|---|---|---|---|
| home | **434** | 318 | 612 |
| rsvp-queue | 1406 | 1580 | 1627 |
| guest-list | 1694 | 1788 | 2131 |
| rooms | **436** | 310 | 436 |
| arrivals | 434 | 637 | 482 |

### Tap (family row → family record) — median of 3, ms

| Profile | M1 first visual change | M2 destination frame | M3 real rows | M5 back to list |
|---|---|---|---|---|
| venue-wifi | 366 | 1713 | 1713 | 21 |
| 4g | 214 | 1553 | 1553 | 22 |

### What changed, and what the numbers do **not** say

- **Rooms 6303 → 436 ms and home 4917 → 434 ms are not a fair dev-to-prod comparison on their
  own.** The tree also advanced: `23dacc2` is V1, while this run is on `brain/showcase`, which
  carries the V4–V12 work (the tap paints the destination, the RSVP save is one round trip, the
  arrivals board moved onto the shared query cache). Isolating "dev vs prod" from "V1 vs V12"
  would mean rebuilding `23dacc2` in this environment, which was not done. Treat this section as
  **the current number to beat**, not as a claim about how much of the gain was the build mode.
- **The network leg is not a staff phone.** The browser, the Next server and the Supabase client
  are all on one machine; only the browser→server hop is throttled through CDP, and Supabase is
  reached from this machine in Seoul-adjacent conditions. A handset in India adds the
  India→Vercel(`bom1` edge → `icn1` compute) leg that no local measurement can include. These are
  best-case numbers for the app's own work.
- **M2 == M3 at the moment.** The destination counts as "the frame is up" only when the whole
  record has rendered, so today it arrives with the real rows. S4 (placeholder data from the
  tapped row) is what is supposed to pull M2 below M3 — when it does, this table is what shows it.
- **M5 is already fast (21–22 ms) because the "back" is a client-cache read.** That is the
  `arrivals` pattern working, not a new fix; the S4 scroll/filters restore is still to be done.

### To reproduce

```bash
NEXT_PUBLIC_UI=v2 npm run build
NEXT_PUBLIC_UI=v2 npm run start          # http://localhost:3000
node scripts/feel-baseline.mjs           # FEEL_OUT_DIR overrides where the log/json land
```

The harness now reads `.env`/`.env.test` from the CWD first and the historical
`C:\dev\EventFlow` location last, so it runs from any worktree, and it writes its log/json to
`FEEL_OUT_DIR` (else the scratchpad, else the CWD) instead of a hardcoded path in another
checkout.

---

## 2026-09-21 — V1 baseline, `next dev` (superseded, kept for comparison)

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
