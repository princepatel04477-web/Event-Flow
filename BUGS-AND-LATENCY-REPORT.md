# EventFlow — Bug & Latency Report

**Date:** 7 October 2026
**Scope:** find and track every bug found, and reduce latency (the two standing asks).
**Method:** multi-agent exploration of `src/`, `android/`, `scripts/`, and the repo's own
report/log files, then **each finding verified against the actual source** before it was
acted on (a summary's word is not evidence — see the house rule).

---

## Headline scoreboard

| | |
|---|---|
| Findings raised | **32** (4 Blockers, 12 Should-fix, 16 Worth-knowing/backlog) |
| Confirmed against source | **30** of 32 (2 marked UNCONFIRMED) |
| **Fixed in this pass** | **11** — incl. all 4 Blockers and all 4 server round-trip waterfalls |
| Verified green | `tsc --noEmit` clean · `vitest run` **857 passed / 72 files** · `eslint` clean on every changed file |
| Measured bundle (prod build) | shell **556.7 KB raw / 168.8 KB gzip** on every route · 3.81 MB raw total |
| Latency harness | **not run here** — needs Chromium + a prod server + seeded DB; see Caveats |

---

## ⚠️ Caveats — what I could NOT verify (honest, not hidden)

1. **No browser / no handset in this environment.** The latency harness (`npm run latency`)
   needs `chromium.launch()`, a production server, and a seeded Supabase event. I did **not**
   run it, so I have **no tap→visible milliseconds**. What I report below as latency gains are
   **structural round-trip counts derived from the code** (exact and reviewable), not timings.
2. **No live database.** No `supabase` calls were executed; the RLS/DB behaviour is reasoned
   from the migrations and the reader code, not measured.
3. Everything claimed **fixed** was checked by `tsc`, the full unit suite, and eslint — the
   same three gates CI runs. Nothing was claimed on the strength of an edit alone.

---

## Part A — Latency

### A1. The core problem: serial round trips to Seoul (fixed)

The app runs in an Android WebView against Supabase in **Seoul (`ap-northeast-2`)**; a call to
that round trip is the dominant cost on a handset. The project's own interaction contract,
**T5 — "one tap is one round trip, at most"** (DECISIONS.md:2222), forbids sequential awaited
network calls in one action. Four read paths broke it.

| Path | Before (serial stages) | After | Δ |
|---|---|---|---|
| `readRoomsGrid` (`src/lib/actions/rooms.ts`) | **6** reads, one after another | 1 `Promise.all` | **−5 round trips** |
| `readRoomingList` (`src/lib/actions/rooming-list.ts`) | **6** reads, one after another | 1 `Promise.all` | **−5 round trips** |
| v2 shell (`src/app/(app)/v2/[eventCode]/layout.tsx`) | `access` → `staffCtx` → `arrivalsNotify` → `hasGuestList` = **4 serial after the initial batch** | one `Promise.all` for the last three | **−2 round trips on EVERY navigation** |
| `readAllocationData` (`src/lib/actions/rooms.ts`) | `Promise.all(3)` → hotels → assignments = **3 stages** | `Promise.all(4)` → hotels = 2 stages | **−1 round trip** |

**Why batching is safe here (and why the old "flaky" note was wrong).** Both serial readers
carried a comment claiming the grid "was flaky at 543-guest scale when five requests fired
concurrently". That diagnosis cannot apply: `createClient()` in `src/lib/supabase/server.ts`
returns a **fresh client per call, on purpose** ("a memoised client … can leak one request's
session into another's reads"). With no shared client there is no shared-client race to be
flaky about — six independent `eq('event_id', …)` reads against one per-call client are
ordinary concurrent use. The comment has been rewritten to record this.

The prior record bears this out: `docs/FEEL-BASELINE.md` measured **Rooms at 6.3 s** on
venue-wifi — the worst route ever measured — which is exactly what six stacked Seoul hops
looks like.

### A2. Measured bundle (real numbers from `npm run bundle-size`, prod build)

```
total        118 chunks · 3.81 MB raw · 1.19 MB gzip
shell        (loaded on EVERY route) 7 chunks · 556.7 KB raw · 168.8 KB gzip
largest routes (raw / gzip):
  /v2/[eventCode]/guests/import            1.66 MB / 527 KB
  /v2/[eventCode]/hospitality/rooming-list 1.61 MB / 510 KB
  /v2/[eventCode]/logistics/sheets         1.60 MB / 507 KB
largest chunks: 463.5 KB, 427.7 KB (xlsx territory)
```
This is the first bundle number recorded in the repo (none existed). The ≈1.6 MB route
bundles are dominated by **xlsx** — see backlog item L-XLSX.

### A3. Latency backlog (confirmed, NOT fixed — ranked)

1. **L-VIRT — unvirtualized lists (P0).** `RoomingList.tsx` (`shown.map` over every room×family
   row), `ArrivalsClient.tsx` (every arrival, 4 `useState` per row), `CheckInClient.tsx` (every
   family). FEEL-BASELINE already proved the cost: the DB answered in 5 ms and the WebView spent
   **26 s** mounting 543 cards. `GuestsClient.tsx` has a windowed-`tbody` pattern to copy.
2. **L-XLSX — lazy-load `xlsx` (P1, but not a one-liner).** Seven client components statically
   `import * as XLSX from 'xlsx'`, putting the library on the tap path for job screens. A per-
   screen `await import('xlsx')` **alone does not move the chunk** where the export goes through
   `src/lib/export/workbook.ts`, which also imports xlsx statically — that module must be made
   lazy (or take XLSX as a parameter) as part of the same change.
3. **L-DEBOUNCE — per-keystroke work (P1).** `AllContacts.tsx` filters + `sort`s the whole queue
   per keystroke; `RoomsBoard.tsx` re-scans every occupant per keystroke. Both should debounce
   the term (~250 ms) as `StaffGuestDirectory`/`GuestsClient` already do.
4. **L-SELECT — `select('*')` on the calls board (P1).** `CallNext.tsx` pulls the whole
   `v_rsvp_queue` and filters it four times per render.
5. **L-FONTS (P1).** 13 woff2 files/5 families loaded in the root layout; the Indic cuts can be
   `preload: false`.
6. **L-POLL (P1).** `ArrivalBanner.tsx` holds a Realtime channel **and** a 60 s server-action
   poll per staff session.

---

## Part B — Bug tracker

Severity: **BLOCKER** (data loss / wrong data / session loss). **SHOULD** (user-visible
defect). **WORTH** (minor/known).

### Fixed

| # | Sev | Bug | File | Fix |
|---|---|---|---|---|
| B1 | BLOCKER | **SessionBridge resume listener is one-shot.** The effect deps were `[router, pathname]`, so every client-side navigation ran the cleanup → `appHandle.remove()`, and the `hydratedRef` guard refused to re-add it — so after the first navigation the app had **no `appStateChange` listener** for the rest of the session. A `sessionStorage` marker also made rehydration one-shot. This is the Tier-0 "bounced to /login mid-shift" failure the component exists to close. | `src/components/native/SessionBridge.tsx` | Listener moved to its own effect; `pathname` read via ref; the one-shot marker deleted (restore is idempotent by construction). |
| B2 | BLOCKER | **`tel:`/`mailto:` interceptor never wired.** `wireExternalLinkInterception()` (and `initSentry()`) sat in `src/app/layout.tsx` inside `if (typeof window !== 'undefined')` — but that file is a **server** component, so `window` is always undefined there and the module is never shipped to the browser. Grep confirmed the only caller was this dead one. Every raw `tel:` anchor risked navigating the WebView (the Tier-0 call bug). | `src/app/layout.tsx`, `src/components/native/NativeBridge.tsx` | Removed the dead block; wired both from the client `NativeBridge`. Sentry SDK is imported dynamically and no-ops without a DSN, so the ~66 KB stays off the happy path (no bundle regression). |
| B3 | BLOCKER | **A lost response after a proof commits queues a second, undeletable proof.** `handleConfirm` called `submitProof` with **no** idempotency key, so `submitProof` minted a fresh UUID for the storage path; any throw (incl. a response lost after the upload+insert committed) fell into the catch and called `queueProof`, which minted **another** key → replay wrote a second path → the `storage_path` unique index never fired. `delivery_proofs` is insert-only; nobody can correct or delete it. | `.../deliveries/[deliverableId]/DeliveryDetail.tsx` | One key minted before the attempt, threaded into **both** `submitProof` and `queueProof({ localId })`. |
| B4 | BLOCKER | **Concurrent flushes replay the same queued write once per mounted hook.** `flushWriteQueue` had no in-flight guard, and every `useOptimisticAction` installs its own drain — so on offline→online they all read the same rows before any delete and each row was sent once per hook. One queued `assign-guests-room` could place the *next* unplaced guests into rooms nobody chose. | `src/lib/mutate/write-queue.ts` | Module-level in-flight promise; later callers await the running pass. |
| B7 | SHOULD | **Write-queue backoff measured from creation.** Once a row was >60 s old every `dueAt` was in the past, so it retried on every drain with no spacing. | `src/lib/mutate/write-queue.ts` | New `lastAttemptAt` field; backoff = `lastAttemptAt + backoffMs(retries)`. |
| B8 | SHOULD | **Proof queue never honoured its own backoff.** `backoffMs` existed but `flushProofQueue` never called it. | `src/lib/proof-queue.ts` | Same `lastAttemptAt` fix + in-flight guard (parity with B4). |
| B9 | SHOULD | **Error card lied.** With no `NEXT_PUBLIC_SENTRY_DSN` the boundary told the runner "The event team has been notified" while nothing is reported. | `src/components/native/SentryErrorBoundary.tsx` | Copy now true: "Tap Reload to carry on. If it keeps happening, tell your coordinator." Stale comment corrected. (Retired colours/fonts in the card noted in backlog.) |
| B10 | SHOULD | **"Received by (name)" collected and silently discarded.** `submitProof` has no such field and `delivery_proofs` is insert-only, so the value could never be added later. | `.../DeliveryDetail.tsx` | Field + state removed, with a comment recording why. |
| B11 | SHOULD | **`today` computed in UTC.** `new Date().toISOString().slice(0,10)` returns the UTC day; IST is UTC+5:30, so between 00:00 and 05:30 the arrival banner described *yesterday* — the exact event-morning window a runner reads it. | `src/app/(app)/v2/[eventCode]/layout.tsx` | IST date via `Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'})` — the same pattern `families/[groupId]/page.tsx` already uses; DECISIONS already mandates IST. |
| B12 | SHOULD | **Resume never drained the offline queues.** The native `appStateChange` handler only called `supabase.auth.refreshSession()` (a no-op for code-auth sessions) and the queues relied on `visibilitychange`, which is not guaranteed on Android resume. | `src/components/native/NativeBridge.tsx` | On resume (and online) it now dynamically imports and flushes both the write queue and the proof queue. |
| F1–F4 | — | Serial Supabase reads | see Part A | batched with `Promise.all` |

### Open (confirmed, not fixed — prioritized)

| # | Sev | Bug | Where | Outline of the fix |
|---|---|---|---|---|
| B5 | SHOULD | **A write that keeps failing has no surface**, and the threshold is 5 not 3. `stuckWrites()`/`listQueuedWrites()` have **no caller**; only the proof queue surfaces (on `/debug`). | `src/lib/mutate/write-queue.ts` | Render `stuckWrites()` (with a Retry) in the shell beside `UndoBar`; align threshold to 3. |
| B6 | SHOULD | **Offline banner counts only the proof queue** and flushes only on an `online` *transition* — it reads "0 changes queued" while call-outcome / write / voice-note queues hold rows. | `src/components/native/OfflineBanner.tsx` | Sum all four queues; flush all four from one trigger. |
| B13 | SHOULD | **Read actions treat a failed query as an empty event** ("No rooms / No vehicles / Nothing to call") — the screen lies as fact. | `rooms.ts`, `logistics.ts`, `fleet.ts`, `CallNext` | Check `.error` and return an honest failure state (F2 already did this for vehicle planning). |
| B14 | SHOULD | **Raw Postgres/storage text rendered to staff** (SQLSTATE / table names in a red box). | `DeliveryDetail.tsx`, `voice-note/upload.ts`, `rooms/new/page.tsx` | Route through `friendlyDbError`; keep raw text for `captureDiagnostic` only. |
| B15 | SHOULD | **"Back to fleet" links with the event UUID → 404.** | `.../logistics/LogisticsClient.tsx:362` | Use the event **code**. **UNCONFIRMED** in the current tree — verify before fixing. |
| B16 | WORTH | Cookie lives 30 days, token expires in 7 → pointless re-login at day 8+. | `src/lib/auth/session.ts` | Align cookie max-age to the token lifetime. |
| B17 | WORTH | `queuedCount` is the whole-queue total, so screens overstate the backlog. | `src/lib/mutate/useOptimisticAction.ts:140` | Count per kind/event. |
| B18 | WORTH | "Not yet confirmed" placeholder exists (`FieldRow`) but screens rendering optional values directly can still show blanks/dashes. | various | Sweep; **UNCONFIRMED** specific instances. |
| B19 | WORTH | `Chip`/`SyncChip` tap targets below the 44 px floor. | `src/components/ui/Chip.tsx:46`, `SyncChip.tsx:31` | Enforce `min-h-11`. |
| B20 | WORTH | Silent guard bounces to `?denied=section` on some v2 hospitality re-exports and Find. | `.../hospitality/checkin|rooms/new|rooms/allocate/page.tsx`, `StaffGuestDirectory.tsx` | Re-export the section guard. |
| B21 | WORTH | Fire-and-forget `console.error` on a failed departure tap — the tap looks like it did nothing. | `DeparturesBoard.tsx:138` | Surface an honest message. |
| F6–F16 | — | latency backlog | see Part A | — |

### Checked and NOT a defect (so the next reader doesn't re-open them)

- Camera capture params (`MAX_EDGE 1600`, `quality 70`, `CameraSource.Camera`, EXIF strip) — as spec'd.
- `Capacitor Preferences` vs `localStorage` — correctly branched on `Capacitor.isNativePlatform()`.
- `useOnline` and the TanStack Query defaults (`staleTime 30s`, `refetchOnWindowFocus:false`,
  `networkMode:'always'`) — these are correct and deliberately tuned; left untouched.
- The `tel:` handoff primitive (`openExternalUrl`) was right all along — only the **interceptor**
  wiring (B2) was missing.

---

## Verification (exact numbers)

```
npm run typecheck   →  clean (tsc --noEmit, no output)
npm run test:run    →  72 files passed, 857 tests passed (25.99s)
npx eslint <changed files>  →  clean
npm run bundle-size →  shell 7 chunks · 556.7 KB raw · 168.8 KB gzip
```

`git diff --stat`: 10 files changed, 323 insertions(+), 160 deletions(−).

---

## How to re-run (for the next session / another AI)

```bash
npm run typecheck
npm run test:run

# Latency + bundle need a PRODUCTION build (never next dev):
$env:NEXT_PUBLIC_UI='v2'; npm run build
$env:NEXT_PUBLIC_UI='v2'; npx next start -p 3000
BASE=http://localhost:3000 npm run latency    # needs Chromium + a seeded event
npm run bundle-size                           # reads .next/
```

The latency gate is p50 on the four budgets in `scripts/perf-core.mjs` (tap→first change ≤120 ms,
tap→content ≤120 ms, save→shown ≤120 ms; cold load ≤2500 ms informational). Output lands in
`e2e/latency-results.json` and `docs/LATENCY.md`.

---

## Recommended order for the next pass

1. **Run `npm run latency` on a handset/emulator** to get the before/after *timings* this pass
   could not produce. The round-trip counts above predict the biggest movement on **Rooms** and
   **Rooming list**.
2. **Virtualize** the rooming list, arrivals board and check-in board (L-VIRT) — proven 26 s risk.
3. **Lazy `xlsx`** — but fix `src/lib/export/workbook.ts` in the same change or the chunk won't move (L-XLSX).
4. **B5/B6** — give the write queue a visible surface and make the banner count all four queues.
5. **B13/B14** — stop failed reads reading as "empty event", and stop raw DB text reaching staff.
