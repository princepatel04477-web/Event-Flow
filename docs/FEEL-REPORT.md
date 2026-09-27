# FEEL report — did the series work?

Written by the overnight run on `feel/phase-b` (2026-09-27). The S0 "before"
numbers are the production-build baseline in `docs/FEEL-BASELINE.md` (2026-09-26,
`9a5b678`, measured on `npm run start`). The "after" column is **not yet
re-measured**: re-measurement needs a production build served locally plus the
browser harness (`scripts/feel-baseline.mjs`), which signs in through the real
`/login → /pick-staff` flow and throttles over CDP. That is the handset item to
close, not something a code-only pass can invent.

A FAIL below is a valid result — it names the next thing to fix, not a reason
to ship anyway.

## Budgets

| Metric | Budget | S0 (before) | After |
|---|---|---|---|
| `tap-to-visual-feedback` | ≤ 100ms | 366ms (venue-wifi, M1) | **pending** — S1 `Pressable` press + `useLinkStatus` are the mechanism to beat it |
| `tap-to-destination-frame` | ≤ 300ms | 1713ms (venue-wifi, M2) | **pending** — S4's `placeholderData` from the tapped row is the mechanism |
| `tap-to-content` (cached list) | ≤ 150ms | not measured | **pending** — S3/S5 make revisits cache reads |
| `tap-to-content` (uncached list) | ≤ 2000ms | rsvp-queue 1406, guest-list 1694, rooms 436, arrivals 434 | **pending** |
| One action's total server time | ≤ 500ms | not measured | **pending** — `traceFetch` emits it; needs server timing |

## The three slowest things left

Ordered by what a runner will feel first on a cold open, each with the file
that owns it:

1. **Guest list first visit** — `src/app/(app)/v2/[eventCode]/guests/list/`
   (S0: 1694ms venue-wifi). It is in the S5 persist allowlist, so a *return*
   paints from disk, but the first visit still pulls the whole directory.
2. **Call queue first visit** — `src/app/(app)/v2/[eventCode]/rsvp/queue/`
   (S0: 1406ms venue-wifi). Same shape: cached on return, cold on first open.
3. **Family record destination frame** — `src/app/(app)/v2/[eventCode]/rsvp/`
   (S0 M2: 1713ms). S4's `placeholderData` paints the header from the tapped
   row; the full record still lands on the network read, which is where the
   remaining M2 gap lives.

## What changed in this run (and where the gains should show)

- S2 `route_context` (now returns A8 section locks) — one context round trip.
- S3/S4/S5 — Rooms/Home revisit cache, instant family header, offline-start
  persistence (now partitioned by staff identity, G5).
- M1/M2 motion + dark mode, M3 staggered Home entrance, M4 SuccessMark
  auto-advance, M5 haptic + count-up numbers.

## To close the "after" column

```bash
NEXT_PUBLIC_UI=v2 npm run build
NEXT_PUBLIC_UI=v2 npm run start   # http://localhost:3000
node scripts/feel-baseline.mjs    # FEEL_OUT_DIR overrides where the log/json land
node scripts/tap-budget.mjs       # light and dark
```
