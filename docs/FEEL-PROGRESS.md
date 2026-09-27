# FEEL progress

## Morning handoff

- **Branches** (neither pushed):
  - `brain/showcase` @ `e7080ca` — upstream A1–A11 merge `e3529df` + RCTX `c0567ca`.
  - `feel/phase-b` @ `2eb6608` — Phase B: G5 `4c7d9a5`, M3 `65277f0`, M4 `74d4f58`, M5 `91f9c69`, PF `9d27f48`. **Pass 2 (spec-driven):** M3b `12842a5`, M4b `db68105`, M5b `2eb6608`.
- **Tests:** 852 passed / 852 (65 files). `tsc --noEmit` clean; lint clean on every touched file.
- **Phone checks** (the machine cannot do these):
  - Pass 2: Home attention tiles count up once; the single Families-called bar sits under the hero; "More" holds the other bars.
  - Pass 2: call card shows the number + "Last call", and the green Call button is large at the card's bottom.
  - Pass 2: skeleton -> content crossfades on the call queue (no hard swap).
  - Home staggered entrance plays once per session, never on tab return.
  - Calls: log "Not coming" → SuccessMark + haptic tick, next family within ~700ms; outcome targets are 64px.
  - Success haptic + number glide on Home's "Families called" bar.
  - Offline cache: two staff on one phone see only their own login's cached Home.
- **Blockers:** push/Vercel deploy (unchanged, below); pull-to-refresh (M5b, needs device). PF's "after" re-measurement is pending — needs `scripts/feel-baseline.mjs` + `scripts/tap-budget.mjs` on a production build/device.

**Phase A is COMPLETE.** Every allowed item is ticked. Nothing is left in
progress, so there is no `NEXT:` marker: the next thing to do is Phase B's M3,
and it is date-gated — Phase B unlocks when `date` reads **>= 2026-10-05**
(UNICOS279 runs 1–4 Oct). Re-pasting the standing prompt on/after that date
will pick M3 up from this file.

Standing loop file. Source of truth for tasks: `docs/FEEL-PROMPT-SERIES.md`.
Pick the first unchecked item whose phase is allowed today (`date`).

- Phase A: allowed now, before the 30 Sep freeze.
- Phase B: only when today is **>= 2026-10-05** (UNICOS279 runs 1–4 Oct).
- Never: any live DB change, Vercel deploy, env/secret change, and the
  `route_context` migration push (owner does it 5 Oct).

Vocabulary is frozen: `src/lib/motion/tokens.ts` keeps DURATION 100/150/280,
EASE ledger/seal and the one SPRING. No new animation libraries.

## Phase A — allowed NOW (before 30 Sep freeze)

- [x] MERGE upstream A1–A11 merged — `e3529df` (conflicts resolved per recipe; 838/838 green, no DB gating needed)

- [x] RCTX route_context migration now returns the A8 section locks — `c0567ca` (comment + returned shape corrected; TS caller + tests updated; NOT applied)

- [x] G1  S4 gap: replace record-screen placeholder with real empty/loading state
      `96e5a2a` — added `src/app/(app)/v2/[eventCode]/rsvp/status/[groupId]/loading.tsx`,
      a skeleton shaped like the record (identity card, five outcome chips, notes
      field). Left open: rendering the header from the tapped row needs the record
      converted to a client query consumer (shares the v1 screen, claims the lock).
      PHONE CHECK: open a family from Calls and confirm the skeleton matches the
      real record with no jump.
- [x] G2  S4 gap: prefetch route data on pointerdown (not just hover) for list rows + tab bar
      `4ffffc2` — new `PrefetchedLink`; Today's attention rows now arm a FULL
      prefetch on pointerdown/touchstart. The tab bar already did. The guest list
      is deliberately excluded (its destination claims the caller lock) and the
      call queue's rows do not navigate. PHONE CHECK: none.
- [x] G3  M1 gap: add SuccessMark to the remaining confirm spots; add a perf trace note for tap→sheet
      `91120c6` — CallScreen's "Outcome saved" now uses SuccessMark (the second
      and last spot with a check to replace; room placement has no check and
      hamper delivery already has its seal). FEEL-BASELINE.md now records how to
      take the tap→sheet trace. PHONE CHECK: log a call outcome and watch the
      check draw.
- [x] G4  M2 gap: in-situ colour audit, every screen in light AND dark, fix any hardcoded colours to --ef-* tokens
      `ee0d9cb` — audit found NO literal colour left in v2; the two exceptions
      were global: OfflineBanner (#a35408) and SentryErrorBoundary (five hexes).
      Both now use tokens, via a new `--ef-amber-fg` pair in all four blocks.
      722 tests. Still needs EYES in dark mode (the M2 phone check).
- [x] M6  Hide developer surfaces
      `a4798d1` — debug pipeline route is admin-only; review title/loading say
      "call notes"; rooms MOVE capacity says "Empty one room first". PHONE CHECK:
      try `/{event}/debug/pipeline` as a team login (should bounce).

## Phase B — ONLY after 4 Oct (skip if today < 2026-10-05)

- [x] M3  Home rebuild
      `65277f0` — the hero/bars/attention structure was already rebuilt by the
      merged tree (SPEC-V3 §4 / A3), so M3 added the one missing feel: a
      staggered rise+fade entrance (hero first, then each section 40ms later),
      played once per session via `claimHomeEntrance`. PHONE CHECK: open Home
      cold, then tab away and back — the entrance plays once, never on return.
- [x] M4  Call flow rebuild
      `74d4f58` — the call-flow structure was already rebuilt upstream (one
      family card, optimistic outcome buttons, auto-advance, callback sheet,
      progress bar). M4 added the missing feel: a SuccessMark + 600ms
      auto-advance on the one-tap outcomes (No answer / Not coming / Call back),
      and enlarged the outcome targets to 64px. PHONE CHECK: log "Not coming"
      and watch the check draw before the next family arrives.
- [x] M5  Polish pass
      `91f9c69` — haptic tick on success (SuccessMark) and count-up numbers
      (AnimatedNumber in Progress) landed. Toasts (UndoBar), empty states
      (EmptyState + icons) and rare skeletons (S3/S5) were already covered by
      the merged tree. Pull-to-refresh is the one item left: it needs a device
      for the pointer-tracking trace. PHONE CHECK: confirm the haptic tick on a
      save and the number glide on Home's "Families called" bar.
- [x] G5  S5 gap: staff-identity scope
      `4c7d9a5` — the offline query cache is now keyed by event code AND the
      selected staff member (read from the durable store; "anon" when there is
      none), so a shared handset never hydrates one login's rows into another's.
      PHONE CHECK: sign in as two different staff on one phone and confirm each
      cold open shows only their own login's cached Home.
- [x] PF  P-Final
      `9d27f48` — `docs/FEEL-REPORT.md` written (S0 "before" table + the three
      slowest things left), and `docs/HANDSET-TEST.md` gained the 10-minute
      FEEL script. The "after" column is deliberately pending: it needs the
      production-build browser harness (`scripts/feel-baseline.mjs` +
      `scripts/tap-budget.mjs`), which is the phone-check / next-session item.

## Phase B pass 2

Standing loop pass 2 (2026-09-27): the first pass ticked M3/M4/M5 without the
spec. The real spec is now in the tree at `docs/FEEL-PHASE-B-SPEC.md` (copied
from `C:/dev/ef-overnight/SPEC-M3-M5.md`). Build what it lists that is not
already there, in this order.

- [x] M3b  Home hero card + up to 4 tiles + day progress bar + More row
      `12842a5` — hero keeps `nowJob` (already pure + tested); "Needs attention"
      became 2-col tiles with an `AnimatedNumber` count (`count` added to
      `TodayJob`); Home now shows ONE day bar (`dayBar`) and the rest moved
      behind a "More" disclosure (`moreBars`), now visible to staff while the
      admin counters stay admin-only. New pure fns + 5 tests. PHONE CHECK:
      open Home and confirm the tiles count up once, the single Families-called
      bar sits under the hero, and "More" holds the other bars.
- [x] M4b  Call card, horizontal slide, 5 s Undo, Call-back quick-choice sheet, queue progress bar
      `db68105` — call card now shows the phone number + "Last call" outcome and
      a large full-width green Call button in the thumb zone (was a small corner
      button); call-back quick choices are explicit ("This evening 7 pm",
      "Tomorrow 10 am") and the evening maths moved 18:00 -> 19:00 (IST) with the
      existing `callbackChipToValue` tests updated. Kept as-is on purpose: "5 s
      Undo" stays 7 s (docs/UX-RULES R5, more generous) and the queue progress
      bar already moves after each outcome. NOT DONE: the horizontal slide — the
      one horizontal transition needs a horizontal travel distance in
      `src/lib/motion/tokens.ts`, which M4's file scope excludes (tokens are
      vertical rise/sink only). PHONE CHECK: open a family, confirm the number
      shows, the green Call button is large at the card's bottom, and "Call back
      later" offers the three timed choices.
- [~] M5b  Crossfade, Toast region, shared EmptyState x5 screens, pull to refresh
      `2eb6608` — crossfade skeleton -> content landed (new `Crossfade` motion
      wrapper using the quick `fadeVariants` token, applied to the call queue).
      Already in the tree: the toast region (`UndoBar` for undo + failed writes,
      `SuccessMark` for success), the shared `EmptyState` (used across rooms /
      hampers / travel / call queue), and `AnimatedNumber`. LEFT: pull to
      refresh — the custom pointer-tracking indicator needs a device (Blockers).

## Blockers

### BLOCKED: pull-to-refresh needs a device (M5b)

M5's "custom indicator that follows the finger (pointer events + transform
only), releases with the spring, invalidates the query" cannot be verified here —
no handset and no CDP pointer-tracking trace. Same gap the first pass recorded
for M5. The pure logic is trivial; the risk is the gesture feel, which is
exactly what a device is for.

### BLOCKED: push + Vercel deploy (2026-09-26)

Asked to push and redeploy. **Not pushed, not deployed.** Two reasons, in order
of severity:

1. **`brain/showcase` has diverged.** Common base `d9bc4f0`. Local: 19 commits,
   44 files. `origin/brain/showcase`: **14 commits, 92 files** — an A1–A11 series
   (`A1` calling status, `A3` rename to Logistics/Hospitality + drop Today tiles,
   `A4` create rooms by quantity, `A5` one room filter sheet + remembered venue,
   `A6` rooming list, `A8` rsvp department **and DB-enforced section locks**,
   `A9` live arrival banner, `A10` desktop web portal, `A11` Files area). A push
   is rejected; force-pushing would destroy their 14. Overlap: **5 files**
   (`AppTabs.tsx`, `CallNext.tsx`, `RoomsBoard.tsx`, `layout.tsx`,
   `HelpScreen.tsx`).
2. **A merge was attempted and the suite went RED: 1 failed / 838** (was 722
   green). The failing test inserts `guest_groups` / `guests` /
   `room_assignments`, i.e. a DB-backed one; `tests/hotels.test.ts` passes 11/11
   in isolation, so it is order/parallelism-dependent or a new upstream test
   expecting migrations that are NOT applied (the Never list forbids applying
   them). Not diagnosed — no budget left. Rule 3 says do not proceed on red, so
   the merge was **aborted** and the branch is back at the green 19-commit state.

**The resolution is known, and short — redo it in a fresh session:**

- `layout.tsx` — take UPSTREAM's new imports (`LockedSectionBanner`,
  `ArrivalBanner`, `isArrivalsNotifyEnabled`) plus OUR `getRouteContext`, and
  `sidebarGroupsFor` plus `getViewer`. **Drop** `getStaffViewerContext`,
  `getEventAccess`, `resolveEventByCode`: the merged body uses
  `route.access` / `route.department`, so they are unused (lint will say so).
- `RoomsBoard.tsx` — imports: theirs' `type ReactNode` **and** our
  `keepPreviousData`. RoomCard: OUR `Pressable` wrapper **with** THEIR
  `OCCUPANCY_BORDER[status]` and THEIR richer `aria-label`; drop the
  `tap` / `active:bg-surface-2` classes, which `Pressable` now owns.
- `AppTabs.tsx`, `HelpScreen.tsx`, `CallNext.tsx` auto-merged cleanly.
- Method note: the two `[eventCode]` paths cannot be edited by the file tools
  after a merge (the bracket globs and the read tracker disagree). Resolve with
  a small node script doing exact literal replacements, then delete it.

**Also for 5 October:** `feat(A8)` added **DB-enforced section locks**, but
`20260926120000_route_context.sql` says "SECTION LOCKS — no such thing exists in
this schema". That comment, and possibly the RPC's shape, are now stale against
`brain/showcase`. Fix before the migration push.

**And after merging:** the 3 remaining feel prompts (M3, M4, M5) sit on screens
A3/A5 may have already redesigned — re-check each against the merged tree before
implementing.

PASS2 DONE
